"""Gun handling, authored: the weapon swap, the reloads, the shotgun's pump and the aiming poses.

These are upper-body actions. Each starts and ends on rifle-hold-low's trunk and the low ready
(the shotgun's carry for the shotgun), so the game can lay it over whatever the legs are doing as
a difference from that hold (character.js). The legs here just stand.

Everything is keyed in the chest joint's frame, as the game works: the trunk (lean, turn, roll of
the chest, the collarbones, where the head looks), each gun (its butt and turn) and each hand.
A hand is either on something (a grip on a gun, the magazine, a shell), and then goes wherever
that thing goes, or on its way between two such holds along an authored path: out and round
through way points, on a minimum-jerk ease, a little past its mark and back (Move). A gun is
either in a hand, and then posed by where that hand takes it, or hanging on its sling.

Keys (Keys, QKeys) are joined by cubic curves through them (Catmull-Rom tangents; a key marked
`stop` is passed at rest), so the motion is smooth and arcs between keys rather than going
straight from one to the next.

A clip is returned as (frames, meta) like gait.py's, with, per frame, besides the trunk and feet:
  gun, gun2   the gun in the hands at the start, and the other one (on the back, or drawn in a swap)
  hands       {side: (wrist, hand rotation)} the hand targets
  poles       {side: direction from the shoulder, chest frame} where each elbow points
  grip        {side: ('gun' | 'gun2', palm point in that gun's frame) or None}, for the review
  props       the loose parts (keys.py): the magazine, the charging handle, the pump, a shell
  curl        {side: 0..1} how far the fingers are closed (0 open, 1 the rifle grip)
and meta['events'] (seconds) and meta['track'] (per frame: hold, curl and parts) for the game.
"""
import math

from mathutils import Matrix, Quaternion, Vector

from .carry import HALF_TURN, PALM_LOCAL, STOW, Carry, basis_quat, hand_quat
from . import pouch
from . import body
from .gait import FPS, leg_span, stand_height
from .skel import SIDE, bone, ypr

DEG = math.pi / 180
DEBUG = None  # (fitting: a list collects the forearm-relative moves' parts)
# weapon.js: where the palm presses on the magazine (half way down its left face, magazine frame),
# and how the hand is turned there (gun frame); MAG_TRAVEL, how far it slides to clear the well;
# HANDLE_TRAVEL, the charging handle's pull
MAG_PALM = Vector(body.T['magPalm'])
MAG_HAND = hand_quat((1, 0, 0), (0, 0.35, -0.94))
MAG_TRAVEL, HANDLE_TRAVEL = 0.09, 0.062
# Pass T1b: the swaps and the reload from empty re-authored so no hand turns a whole turn about its
# forearm (the twist bones then need no unwinding): per body, `unwind` in its table (the old roster
# bodies keep R2's clips exactly). SWAP_ROLL / EMPTY_ROLL: the roll given to that hand's move.
UNWIND = bool(body.T.get('unwind', False))
SWAP_ROLL, EMPTY_ROLL = ROLLS = body.T.get('unwindRolls', (360.0, -360.0))
# shotgun.js: the pump's stroke, and the hand under the loading port
PUMP_TRAVEL = 0.085
PORT_HAND = hand_quat((0.25, 1, 0), (0.7, 0, -0.7))


def warp_time(s, a, b, k, c, e):
    """A clip's time s (seconds) moved by a smooth warp that lets [a, b] run up to 1 + k times slower
    (sin-squared window: C2 at its ends) and takes the same time back from [c, e], so the clip keeps
    its length: s + k H(s; a, b) - k2 H(s; c, e), H the window's running integral (pass F3b)."""
    def H(s, a, b):
        u = min(1.0, max(0.0, (s - a) / (b - a)))
        return (b - a) * (u / 2 - math.sin(2 * math.pi * u) / (4 * math.pi))
    k2 = k * (b - a) / (e - c)
    if k2 >= 1.0:
        raise ValueError('warp_time: the tail cannot give that much time back')
    return s + k * H(s, a, b) - k2 * H(s, c, e)


PAUSE_G = {'quartic': lambda s: 1.0 - 4.0 * (1.0 - s) ** 4 + 3.0 * (1.0 - s) ** 5,  # slope u^3 (16 - 15 u), peak 2.0
           'cubic': lambda s: 1.0 - 3.0 * (1.0 - s) ** 3 + 2.0 * (1.0 - s) ** 4,  # slope u^2 (9 - 8 u) (u = 1 - s), peak 1.69
           # slope (1 - s)^1.75 (1 + 6.5625 s): peak 1.60, 0.68 at s = 0.7
           'p175': lambda s: (7.5625 * (1.0 - (1.0 - s) ** 2.75) / 2.75 - 6.5625 * (1.0 - (1.0 - s) ** 3.75) / 3.75)}
PAUSE_SHAPE = 'p175'


def pause_pace(x, xp):
    """(pass A3) A move's pace x in [0, 1] re-timed to rest at xp: the same start and end (slope 1 there),
    slope 0 at xp with zero curvature (a dwell, not a bounce), monotone; on each side g(s) = 1 - 4u^4 + 3u^5,
    u = 1 - s (slope u^3 (16 - 15 u): peak 2.0 at s = 0.25)."""
    g = PAUSE_G[PAUSE_SHAPE]
    if x <= xp:
        return xp * g(x / xp)
    return 1.0 - (1.0 - xp) * g((1.0 - x) / (1.0 - xp))


def min_jerk(x):
    x = min(1.0, max(0.0, x))
    return x * x * x * (10 - 15 * x + 6 * x * x)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def span(t, a, b):
    return min(1.0, max(0.0, (t - a) / (b - a)))


def arrive(x, over):
    """0 to 1 on a minimum-jerk ease that runs `over` past 1 at four fifths of the way, stops there
    and settles back: a hand or a gun coming to its mark."""
    if x < 0.8:
        return (1 + over) * min_jerk(x / 0.8)
    return 1 + over * (1 - ease((x - 0.8) / 0.2))


class Keys:
    """Values (floats or Vectors) at times, joined by cubic curves. keys: [(t, value)] or
    [(t, value, 'stop')]; the first and last keys are always passed at rest."""

    def __init__(self, keys):
        self.keys = [(k[0], k[1], len(k) > 2 and k[2] == 'stop') for k in sorted(keys, key=lambda k: k[0])]

    def _tangent(self, i):
        k = self.keys
        if i == 0 or i == len(k) - 1 or k[i][2]:
            return k[i][1] * 0
        return (k[i + 1][1] - k[i - 1][1]) / (k[i + 1][0] - k[i - 1][0])

    def __call__(self, t):
        k = self.keys
        if t <= k[0][0]:
            return k[0][1] * 1
        if t >= k[-1][0]:
            return k[-1][1] * 1
        i = max(j for j in range(len(k) - 1) if k[j][0] <= t)
        (t0, v0, _), (t1, v1, _) = k[i], k[i + 1]
        h = t1 - t0
        s = (t - t0) / h
        s2, s3 = s * s, s * s * s
        return v0 * (2 * s3 - 3 * s2 + 1) + self._tangent(i) * (h * (s3 - 2 * s2 + s)) + v1 * (3 * s2 - 2 * s3) + self._tangent(i + 1) * (h * (s3 - s2))


class QKeys:
    """Rotations at times, joined the same way (as 4-vectors kept on one side of the sphere)."""

    def __init__(self, keys):
        out, last = [], None
        for k in sorted(keys, key=lambda k: k[0]):
            q = Quaternion(k[1])
            if last is not None and last.dot(q) < 0:
                q.negate()
            last = q
            out.append((k[0], Vector(q), *k[2:]))
        self.keys = Keys(out)

    def __call__(self, t):
        return Quaternion(self.keys(t)).normalized()


def gun_quat(yaw, pitch, roll):
    """A gun's turn in the chest's frame as carry.HOLDS gives it (degrees)."""
    return ypr(yaw * DEG, pitch * DEG, roll * DEG) @ HALF_TURN


class Spot:
    """Where a hand holds something: the middle of the palm in that thing's own frame (for a gun,
    its import frame, as carry.GUNS) and the hand's turn there."""

    def __init__(self, palm, hand, loose=False):
        # loose: a small part held by the fingers (a charging handle), round which the hand may turn
        # to keep its wrist straight without taking the gun with it
        self.palm, self.hand, self.loose = Vector(palm), Quaternion(hand), loose

    @staticmethod
    def regrip(a, b, t0, t1):
        """A hold that shifts from spot a to spot b between t0 and t1 without letting go: the
        hand rolls round and slides along what it holds."""
        def at(t):
            x = min_jerk(span(t, t0, t1))
            return Spot(a.palm.lerp(b.palm, x), a.hand.slerp(b.hand, x))
        return at


class Hand:
    """One hand over a clip: a list of holds and moves between them, in time order.
      ('hold', t0, t1, what, spot)  on `what` ('gun' / 'gun2', or a callable t -> (palm, quat)
                                    in the chest's frame) at `spot` (None for a callable)
      ('move', t0, t1, via, over)   from wherever the hold before leaves it to wherever the next
                                    one takes it, through `via` (chest-frame palm points), `over`
                                    m past the mark and back
      ('move', t0, t1, via, over, roll)   the same, the hand also rolled `roll` degrees about its
                                    own long axis on the way (eased as its turn is): a whole turn
                                    given back where the shortest turn between the holds would
                                    wind the forearm a whole turn (UNWIND, pass T1b)
    """

    def __init__(self, side, plan):
        self.side, self.plan = side, plan


class Clip:
    """Shared machinery. `author` is gait.Author (its trunk); carry / carry2 are the guns."""

    def __init__(self, author, carry, carry2, stance):
        self.author, self.carry, self.carry2, self.stance = author, carry, carry2, stance
        self.skel = author.skel

    # ---------------------------------------------------------------- pieces

    def low(self):
        """The low ready in track terms (without the gun's carry shift): (butt, turn)."""
        return Carry.local('low')

    def stow(self, carry):
        """A gun's sling place in track terms."""
        s = STOW[carry.gun]
        return s['at'] - carry.shift, basis_quat(s['muzzle'], s['top'])

    def spot(self, carry, name):
        """Named places a hand takes hold of a gun."""
        if name == 'main':
            return Spot(carry.palm['Right'], carry.hand['Right'])
        if name == 'support':
            return Spot(carry.palm['Left'], carry.hand['Left'])
        raise KeyError(name)

    def pouch(self, t):
        """Where the hand takes the fresh magazine or a shell from the belt kit (pouch.py DRAW: the Hips
        joint's frame) in the chest's frame, for frame t, the hand turned to take it out: palm in
        against the hip, fingers down and forward."""
        i = min(len(self.fk) - 1, int(round(t * FPS)))
        pos, rot = self.fk[i]
        cq = rot['spine_05'].inverted()
        at = cq @ (pos['pelvis'] + rot['pelvis'] @ pouch.DRAW[self.carry.gun] - pos['spine_05'])
        hand = hand_quat((-0.8, -0.1, -0.2), (0.15, -1.0, 0.35))
        yaw = pouch.DRAW_YAW.get(self.carry.gun)
        if yaw:  # (a kit turned to the body's surface: the hand turned with it)
            hand = Quaternion((0, 1, 0), math.radians(yaw)) @ hand
        return at, cq @ rot['pelvis'] @ hand

    def by_hand(self, carry, spot, palm, quat):
        """A gun's (butt, turn) in track terms such that `spot` is at `palm` with the hand turned
        `quat` (chest frame): a gun posed by the hand that carries it."""
        turn = quat @ spot.hand.inverted()
        butt = palm - turn @ (spot.palm - carry.butt)
        return butt - carry.shift, turn

    @staticmethod
    def fingers(grip, curl):
        out = {}
        for side in ('Left', 'Right'):
            for name, q in grip.items():
                if name.endswith('_' + SIDE[side]):
                    out[name] = Quaternion().slerp(q, max(0.0, min(1.0, curl[side])))
        return out

    # ---------------------------------------------------------------- building a clip

    def build(self, seconds, trunk, guns, hands, poles, curl, props=None, grip_names=None):
        """trunk(t) -> dict(lean, turn, roll, look_yaw, look_pitch, dip, sway, collar={side: (yaw, roll)})
        in degrees and metres, all on top of rifle-hold-low's; guns(t) -> {'gun': (butt, turn),
        'gun2': (butt, turn)} in track terms (chest frame); hands: {side: Hand}; poles(t) ->
        {side: direction}; curl(t) -> {side: 0..1}; props(t, frame) -> the frame's props."""
        n = int(round(seconds * FPS)) + 1
        frames, design = [], []
        base = stand_height(17)  # the holds' hip height (gait.Author.hold)
        grip = {k: v for k, v in self.author.fingers.items()}
        for i in range(n):
            t = i / FPS
            k = trunk(t)
            hips = Vector((k.get('sway', 0.0), 0.0, -0.02))
            local = self.author._upper(hips, Quaternion(), 'low', lean=(3.0 + k.get('lean', 0.0)) * DEG,
                                       turn=k.get('turn', 0.0) * DEG, roll=k.get('roll', 0.0) * DEG,
                                       head_pitch=(2.0 + k.get('look_pitch', 0.0)) * DEG)
            local['head'] = local['head'] @ Quaternion((0, 1, 0), k.get('look_yaw', 0.0) * DEG)
            for side, (yaw, roll) in k.get('collar', {}).items():
                local[side] = local[side] @ ypr(yaw * DEG, 0, roll * DEG)
            local.update(self.fingers(grip, curl(t)))
            feet = {side: (self.stance[side][0].copy(), self.stance[side][1], 0.0) for side in ('Left', 'Right')}
            frames.append({'hips': hips, 'local': local, 'feet': feet, 'curl': curl(t)})
            design.append(base - k.get('dip', 0.0))
        self.author._hips_height(frames, design)

        carries = {'gun': self.carry, 'gun2': self.carry2}
        chest = []
        self.fk = []
        for i, f in enumerate(frames):
            pos, rot = self.skel.fk(f['local'], f['hips'])
            chest.append((pos['spine_05'], rot['spine_05']))
            self.fk.append((pos, rot))
        # the guns, then the hands on them
        # (each gun's path is smoothed over a few frames: where keys turn a gun fast, the curves
        # through them do not keep its spin even, and the muzzle, 0.8 to 1 m out, shows it)
        raw = [guns(i / FPS) for i in range(n)]
        smoothed = {key: smooth_poses([g[key] for g in raw], 2.0) for key in carries}
        for i, f in enumerate(frames):
            cp, cq = chest[i]
            g = {key: smoothed[key][i] for key in carries}
            f['gunLocal'] = g  # (track terms, chest frame), for the hands below
            for key, c in carries.items():
                at, q = g[key]
                f[key] = {'butt': cp + cq @ (at + c.shift), 'quat': cq @ q}
        self._poles = poles
        f_hands = {side: self._hand_path(h, frames, chest, carries) for side, h in hands.items()}
        for path in f_hands.values():
            # a hand on its own way between holds is smoothed the same way
            free = smooth_poses([(p, q) for p, q, _ in path], 1.5)
            for i, (p, q, held) in enumerate(path):
                if held is None:
                    path[i] = (free[i][0], free[i][1], None)
        self._wrists(frames, chest, f_hands, poles, carries)
        for path in f_hands.values():
            # (a hand on its own way, turned frame by frame for its wrist, is smoothed again)
            free = smooth_poses([(p, q) for p, q, _ in path], 1.2)
            for i, (p, q, held) in enumerate(path):
                if held is None:
                    path[i] = (p, free[i][1], None)
        # (and again after the wrists have turned a gun they carry, frame by frame; a hand on the gun
        # goes with it)
        for key, c in carries.items():
            rel = {}
            for side, path in f_hands.items():
                for i, (p, q, held) in enumerate(path):
                    if held and held[0] == key:
                        at, gq = frames[i]['gunLocal'][key]
                        butt = at + c.shift
                        rel[side, i] = (gq.inverted() @ (p - butt), gq.inverted() @ q)
            again = smooth_poses([f['gunLocal'][key] for f in frames], 1.2)
            for i, f in enumerate(frames):
                f['gunLocal'][key] = again[i]
                cp, cq = chest[i]
                at, gq = again[i]
                f[key] = {'butt': cp + cq @ (at + c.shift), 'quat': cq @ gq}
            for (side, i), (dp, dq) in rel.items():
                at, gq = again[i]
                held = f_hands[side][i][2]
                f_hands[side][i] = (at + c.shift + gq @ dp, gq @ dq, held)
        # (pass A3) `self.pause` {side: (t, t0, t1)}: that hand's free move t0..t1 re-timed (after all the smoothing, so
        # nothing blurs it) to come to rest at t: the game's stow ends and its draw begins at the swap's `slung`
        for side, (tp, ta, tb) in getattr(self, 'pause', {}).items():
            path = f_hands[side]
            i0, i1 = int(round(ta * FPS)), min(len(path) - 1, int(round(tb * FPS)))
            xp = (tp * FPS - i0) / max(1, i1 - i0)
            old = [(path[i][0].copy(), path[i][1].copy()) for i in range(i0, i1 + 1)]
            for i in range(i0 + 1, i1):
                if path[i][2] is not None:
                    continue
                y = pause_pace((i - i0) / (i1 - i0), xp) * (i1 - i0)
                k = min(int(y), i1 - i0 - 1)
                u = y - k
                pa, qa = old[k]
                pb, qb = old[k + 1]
                path[i] = (pa.lerp(pb, u), qa.slerp(qb, u), None)
        for i, f in enumerate(frames):
            cp, cq = chest[i]
            f['hands'], f['grip'], f['palmLocal'] = {}, {}, {}
            for side in ('Left', 'Right'):
                palm, q, held = f_hands[side][i]
                roll = getattr(self, 'rolls', {}).get(side)
                if roll and roll[i]:
                    # (a hand's roll about its own long axis, given after the smoothing, which would
                    # average a fast whole turn away)
                    q = q @ Quaternion((0, 1, 0), roll[i])
                hq = cq @ q
                f['palmLocal'][side] = (palm, q)
                f['hands'][side] = (cp + cq @ palm - hq @ PALM_LOCAL, hq)
                f['grip'][side] = held
            f['poles'] = poles(i / FPS)
            if props:
                f['props'] = props(i / FPS, f)
        if props:
            # the loose parts per frame for the game: the magazine ('w' in the well with its slide,
            # 'h' in the hand, 'x' gone), the charging handle and the pump (m back), the shell
            # (-1 not there, else how far it is into the loading port: 0 in the hand, 1 in)
            track_parts = {'mag': [], 'handle': [], 'pump': [], 'shell': []}
            for f in frames:
                pr = f['props']
                mag = pr.get('mag', ('well', 0.0))
                track_parts['mag'].append(['w', round(mag[1], 4)] if mag[0] == 'well' else ('h' if mag[0] == 'free' else 'x'))
                track_parts['handle'].append(round(pr.get('handle', 0.0), 4))
                track_parts['pump'].append(round(pr.get('pump', 0.0), 4))
                track_parts['shell'].append(round(pr['seat'], 3) if pr.get('shell') is not None else -1)
            self._parts = track_parts
        # what the game needs per frame besides the tracks: which gun each hand holds (0 none, 1 the
        # Gun track's, 2 GunIn's), how far its fingers are closed
        code = {None: 0, 'gun': 1, 'gun2': 2}
        track = dict(hold=[[code[(f['grip'][s] or (None,))[0]] for s in ('Left', 'Right')] for f in frames],
                     curl=[[round(f['curl'][s], 3) for s in ('Left', 'Right')] for f in frames])
        if props:
            track.update({k: v for k, v in self._parts.items() if any(x not in (0.0, -1, ['w', 0.0]) for x in v)})
        meta = dict(duration=(n - 1) / FPS, loop=False, frames=n, cycles=1, speed=0.0, direction=0.0, dir=[0, 0],
                    contact={'Left': [[0.0, 1.0]], 'Right': [[0.0, 1.0]]}, leftStrike=None, track=track,
                    shift={'Gun': self.carry.shift.copy(), 'GunIn': self.carry2.shift.copy()})
        return frames, meta

    # How far a wrist bends before it is turned back (degrees): flexion towards the palm and away
    # from it, deviation towards the thumb and towards the little finger; past KNEE of each it is
    # eased towards the limit, never beyond it.
    WRIST = {'flex': 38.0, 'ext': -38.0, 'radial': 22.0, 'ulnar': -28.0}
    KNEE = 0.65

    def _soft(self, a, hi, lo):
        lim = hi if a > 0 else lo
        k = lim * self.KNEE
        if abs(a) <= abs(k):
            return a
        return k + (lim - k) * math.tanh((a - k) / (lim - k))

    def _wrists(self, frames, chest, f_hands, poles, carries):
        """Keeps every wrist in its range where a hand is on its own (free, or the only hand on a
        gun): the arm is solved as the rig will solve it (two-bone, towards its pole), and a wrist
        bent too far is turned back about the palm, taking a gun it carries round with it. Eased
        in and out over a few frames where the other hand takes or lets go of the same gun, so
        nothing jumps."""
        n = len(frames)
        upper = self.skel.rest['lowerarm_l'].length
        fore = self.skel.rest['hand_l'].length
        alone = {}
        for side in ('Left', 'Right'):
            other = 'Right' if side == 'Left' else 'Left'
            raw = [0.0 if (f_hands[side][i][2] and f_hands[other][i][2] and f_hands[side][i][2][0] == f_hands[other][i][2][0]
                           and not f_hands[side][i][2][2]) else 1.0 for i in range(n)]
            # (eased in after the other hand lets go and out before it takes hold, never while both hold)
            both = [i for i in range(n) if not raw[i]]
            alone[side] = [min([1.0] + [abs(i - j) / 6 for j in both]) for i in range(n)]
        last = {}  # side -> the turn a free hand was given the frame before
        for i, f in enumerate(frames):
            pos, rot = self.skel.fk(f['local'], f['hips'])
            cp, cq = chest[i]
            pole_dirs = poles(i / FPS)
            for side, sign in (('Left', 1), ('Right', -1)):
                w = ease(alone[side][i])
                if w <= 0:
                    continue
                palm, q, held = f_hands[side][i]
                world_palm = cp + cq @ palm
                hq = cq @ q
                # A hand on its own way between holds goes most of the way to a relaxed wrist, starting
                # from the turn it had the frame before: where the arm is folded tight (a hand coming
                # back over the shoulder) the elbow's place swings fast with the hand's turn, and
                # solving each frame afresh can land on a different answer from one frame to the next.
                free = held is None
                fix = last.get(side, Quaternion()) if free else Quaternion()
                relax = 0.4 if free else 1.0
                for _ in range(8 if free else 3):
                    r = hq @ fix
                    wrist = world_palm - r @ PALM_LOCAL
                    shoulder = pos[bone(side, 'upperarm')]
                    elbow = two_bone(shoulder, wrist, upper, fore, shoulder + cq @ pole_dirs[side])
                    d = r.inverted() @ (wrist - elbow).normalized()
                    flex = math.degrees(math.atan2(-d.z, -d.y))
                    dev = -math.degrees(math.atan2(d.x, -d.y)) * sign
                    flex2 = self._soft(flex, self.WRIST['flex'], self.WRIST['ext']) * relax
                    dev2 = self._soft(dev, self.WRIST['radial'], self.WRIST['ulnar']) * relax
                    if abs(flex2 - flex) < 0.05 and abs(dev2 - dev) < 0.05:
                        break
                    want = Vector((math.tan(math.radians(-dev2 * sign)), -1.0, -math.tan(math.radians(flex2)))).normalized()
                    fix = fix @ want.rotation_difference(d)
                if fix.angle > 2.4 and not free:
                    continue  # (a forearm folded back past the hand: no straight wrist to turn to)
                if free:
                    last[side] = fix.copy()
                else:
                    last.pop(side, None)
                fix = Quaternion().slerp(fix, w)
                turn = cq.inverted() @ (hq @ fix @ hq.inverted()) @ cq  # the same turn, chest frame
                f_hands[side][i] = (palm, turn @ q, held)
                if held and not held[2]:
                    key = held[0]
                    at, gq = f['gunLocal'][key]
                    c = carries[key]
                    butt = palm + turn @ (at + c.shift - palm)
                    f['gunLocal'][key] = (butt - c.shift, turn @ gq)
                    f[key] = {'butt': cp + cq @ butt, 'quat': cq @ turn @ gq}

    def _hand_path(self, hand, frames, chest, carries):
        """Per frame (palm, hand turn in the chest's frame, (gun key, palm point) or None)."""
        n = len(frames)
        out = [None] * n
        if not hasattr(self, 'rolls'):
            self.rolls = {}
        self.rolls[hand.side] = [0.0] * n

        def holding(step, i):
            _, t0, t1, what, spot = step
            t = i / FPS
            if callable(spot):
                spot = spot(t)
            if callable(what):
                p, q = what(t)
                return p, q, None
            at, q = frames[i]['gunLocal'][what]
            c = carries[what]
            turn = q
            palm = at + c.shift + turn @ (spot.palm - c.butt)
            return palm, turn @ spot.hand, (what, spot.palm.copy(), spot.loose)

        plan = hand.plan
        for k, step in enumerate(plan):
            kind, t0, t1 = step[:3]
            i0, i1 = int(round(t0 * FPS)), min(n - 1, int(round(t1 * FPS)))
            if kind == 'hold':
                for i in range(i0, i1 + 1):
                    out[i] = holding(step, i)
                continue
            _, _, _, via, over, *roll = step
            # ('move', ..., roll, 'forearm'): the hand's turn eased RELATIVE TO ITS FOREARM (pass F3):
            # its twist about the forearm on the branch nearest the let-go's (plus `roll`, a whole
            # turn only if asked) and its wrist bend on its own, so no forearm winds a whole turn
            forearm = len(roll) > 1 and roll[1] == 'forearm' and UNWIND
            roll = math.radians(roll[0]) if roll and UNWIND else 0.0
            start = holding(plan[k - 1], i0)
            nxt = plan[k + 1]
            if forearm:
                tw0, sw0 = self._parts(self._forearm(i0, start[0], start[1], self._poles(i0 / FPS)[hand.side], hand.side).inverted() @ start[1])
                last = holding(nxt, i1)
                tw1, sw1 = self._parts(self._forearm(i1, last[0], last[1], self._poles(i1 / FPS)[hand.side], hand.side).inverted() @ last[1])
                tw1 += 2 * math.pi * round((tw0 - tw1) / (2 * math.pi))
            for i in range(i0, i1 + 1):
                x = (i - i0) / max(1, i1 - i0)
                end = holding(nxt, i)
                pts = [start[0]] + [Vector(v) for v in via] + [end[0]]
                # knots by chord length, so the hand keeps an even pace along its path
                lengths = [0.0]
                for a, b in zip(pts, pts[1:]):
                    lengths.append(lengths[-1] + max(1e-4, (b - a).length))
                total = lengths[-1]
                path = Keys([(lengths[j] / total, pts[j]) for j in range(len(pts))])
                u = arrive(x, over / total)
                if u <= 1:
                    p = path(u)
                else:
                    tail = (pts[-1] - path(0.97)).normalized()
                    p = pts[-1] + tail * (u - 1) * total
                w = ease(min(1.0, x * 1.25))
                q = start[1].slerp(end[1], w)
                if forearm:
                    pole = self._poles(i / FPS)[hand.side]
                    if DEBUG is not None:
                        DEBUG.append((hand.side, i, math.degrees(tw0), math.degrees(tw1), math.degrees(sw0.angle), math.degrees(sw1.angle)))
                    W = sw0.slerp(sw1, w) @ Quaternion((0, 1, 0), tw0 + (tw1 + roll - tw0) * w)
                    for _ in range(3):
                        q = self._forearm(i, p, q, pole, hand.side) @ W
                elif roll:  # (applied after the paths are smoothed: build(), self.rolls)
                    self.rolls[hand.side][i] = roll * w
                out[i] = (p, q, end[2] if x >= 1 else None)
        if any(o is None for o in out):
            raise ValueError(f'{hand.side} hand: the plan leaves frames uncovered')
        return out


class Swap(Clip):
    """The weapon swap: the gun in the hands goes over the right shoulder onto the back and the
    other comes off it.

      0.00  the low ready
      0.12  anticipation: the weight sinks, the gun dips, the chest turns a touch to the right
      0.10  the support hand lets go and reaches round the left side and behind the hip
      0.32  ... takes the slung gun's fore-end (`draw`) and pulls it down off the back along its
            own length, then swings it forward to the left side, muzzle forward and across
      0.10  the firing hand raises its gun upright at the right side (port), then up and over the
            right shoulder, its forearm running down the back from a raised elbow with the barrel
            along it, and lets go with the gun just above its sling place; the sling takes it
      0.80  the firing hand, back over the shoulder, takes the new gun's grip (the hand-over)
      ...   both hands bring it up into the low ready, a little past and back; the support hand
            slides from the fore-end to its place under it
    """

    SECONDS = 1.35
    # Per gun: how it is held upright before the chest when it comes off the back (muzzle, top),
    # and how it lies along the forearm going over the shoulder (muzzle, top): the rifle's pistol
    # grip and the shotgun's straight stock sit differently in the hand.
    PORT = {'shotgun': (Vector((0.55, 0.75, 0.35)), Vector((-0.2, -0.3, -1.0))),
            'rifle': (Vector((0.55, 0.75, 0.35)), Vector((0.2, -0.6, -0.8)))}
    OVER = {'rifle': (Vector((-0.3, 0.25, -1.0)), Vector((0.0, 1.0, 0.2))),
            'shotgun': (Vector((0.1, 0.25, -1.0)), Vector((0.6, 0.8, 0.1)))}

    def draw_spot(self, carry):
        """The support hand's hold on the slung gun's fore-end: palm against its left face (which
        faces out on the back), fingers round the underside."""
        palm = carry.palm['Left'] + Vector((-0.055, 0.012, 0.03)) + Vector((0, 0, body.T['guns'][carry.gun].get('drawShift', 0.0)))
        return Spot(palm, hand_quat((1, 0, 0), (0, -1.0, -0.25)))

    # Pass F3 (bodies with `unwind`): the outgoing gun's way from the dip to the let-go is given by the
    # firing hand's turn RELATIVE TO ITS FOREARM (the forearm's frame from the two-bone arm towards the
    # elbow pole, as the rig solves it): its twist about the forearm and its wrist bend are eased from
    # key to key on their own, the twist on one branch (no whole turn), the bend kept inside `swing`
    # degrees, and the gun follows the hand. The gun's roll about its barrel at the let-go (`roll`,
    # degrees, settled out as the sling takes it) is chosen so the forearm ends within its range, and
    # the free hand then needs no whole-turn roll (`swapRoll`). TUNE overrides any of them (fitting).
    F3 = dict(solve=False)
    TUNE = {}

    def _forearm(self, i, palm, q, pole_dir, side='Right'):
        """The forearm's frame (chest frame): +Y from the wrist to the elbow, +X the elbow's hinge,
        for the hand at `palm` turned `q` (chest frame) on frame i, the elbow towards pole_dir."""
        pos, rot = self.fk[i]
        cp, cq = pos['spine_05'], rot['spine_05']
        hq = cq @ q
        wrist = cp + cq @ palm - hq @ PALM_LOCAL
        sh = pos[bone(side, 'upperarm')]
        el = two_bone(sh, wrist, self.skel.rest[bone(side, 'lowerarm')].length, self.skel.rest[bone(side, 'hand')].length, sh + cq @ pole_dir)
        y = -(wrist - el).normalized()
        x = (el - sh).cross(wrist - el)
        x = x.normalized() if x.length > 1e-6 else Vector((1, 0, 0))
        return cq.inverted() @ Matrix((x, y, x.cross(y))).transposed().to_quaternion()

    def _swivel(self, i, palm, q, pole_dir, side='Right', step=5):
        """The elbow's turn about the shoulder-to-wrist line (degrees, from where pole_dir puts it)
        that leaves the wrist least bent for the hand at `palm` turned `q` (chest frame), and that
        bend (degrees): [(angle, bend)] for every `step` degrees."""
        pos, rot = self.fk[i]
        cp, cq = pos['spine_05'], rot['spine_05']
        hq = cq @ q
        wrist = cp + cq @ palm - hq @ PALM_LOCAL
        axis = cq.inverted() @ (wrist - pos[bone(side, 'upperarm')]).normalized()
        out = []
        for d in range(-180, 180, step):
            pd = Quaternion(axis, d * DEG) @ Vector(pole_dir)
            tw, sw = self._parts(self._forearm(i, palm, q, pd, side).inverted() @ q)
            out.append((d, math.degrees(sw.angle), math.degrees(tw)))
        return out

    @staticmethod
    def _parts(W):
        """A hand's turn relative to its forearm as (twist about the forearm in rad, wrist swing),
        W = swing @ twist, the swing kept under a half turn."""
        tw = 2 * math.atan2(W.y, W.w)
        sw = W @ Quaternion((0, 1, 0), tw).inverted()
        if sw.w < 0:
            sw.negate()
            tw += 2 * math.pi
        return tw, sw

    def make(self):
        a, b = self.carry, self.carry2
        K = dict(self.F3)
        if UNWIND:
            K.update(body.T.get('swapSolve', {}))
            K.update(self.TUNE)
        else:
            K['solve'] = False

        def T_base(x):
            # (the keys were laid out over 1.2 s; past the draw everything is spread over 1.35 s:
            # the outgoing gun turns three quarters of a circle on its way to the back, and faster
            # its muzzle jolted)
            return x if x <= 0.3 else 0.3 + (x - 0.3) * (self.SECONDS - 0.3) / 0.9
        # (pass F3b, per outgoing gun `timeWarp` {a, b, k, c, e} (s): every key of the clip moved by
        # warp_time, so hands, guns, trunk and events keep in step and the length stays)
        tw_k = (K.get('timeWarp') or {}).get(a.gun) if UNWIND else None

        def T(x):
            return warp_time(T_base(x), **tw_k) if tw_k else T_base(x)
        main_a, main_b = self.spot(a, 'main'), self.spot(b, 'main')
        sup_a, sup_b = self.spot(a, 'support'), self.spot(b, 'support')
        draw_b = self.draw_spot(b)
        low_at, low_q = self.low()
        stow_a = self.stow(a)
        stow_b = self.stow(b)

        # the outgoing gun, by where the firing hand takes it (its palm, chest frame)
        def hand_at(carry, spot, butt_q):
            at, q = butt_q
            return at + carry.shift + q @ (spot.palm - carry.butt), q @ spot.hand

        p0, q0 = hand_at(a, main_a, (low_at, low_q))
        dip_q = gun_quat(46, 37, -8)
        p_dip = p0 + Vector((0.0, -0.014, 0.008))
        port_q = basis_quat(Vector((-0.08, 0.97, 0.22)), Vector((0.1, 0.25, -1.0))) @ main_a.hand
        over_q = basis_quat(*self.OVER[a.gun]) @ main_a.hand
        # let go above the sling place: the gun 24 cm further up its own length and 4 cm off
        s_at, s_q = stow_a
        muzzle = s_q @ Vector((0, 0, -1))
        g_k = {**K, **K.get(a.gun, {})} if K['solve'] else {}  # (per outgoing gun: roll, lift, off)
        rel_at = s_at - muzzle * g_k.get('lift', 0.24) + Vector((0, 0.0, g_k.get('off', -0.04)))
        rel_q = s_q @ Quaternion((0, 0, 1), g_k.get('roll', 0.0) * DEG) if K['solve'] else s_q
        p_rel, q_rel = hand_at(a, main_a, (rel_at, rel_q))
        rise_q = basis_quat(Vector((-0.1, 0.5, 0.85)), Vector((0.0, 1.0, -0.3))) @ main_a.hand
        gun_a_hand = QKeys([(T(0.0), q0), (T(0.10), dip_q @ main_a.hand, 'stop'), (T(0.24), rise_q), (T(0.34), port_q), (T(0.48), over_q), (T(0.66), q_rel, 'stop')])
        hand_a_pos = Keys([(T(0.0), p0), (T(0.10), p_dip, 'stop'), (T(0.24), Vector((-0.3, 0.08, 0.4))), (T(0.34), Vector((-0.34, 0.18, 0.36))),
                           (T(0.48), Vector((-0.33, 0.46, 0.04))), (T(0.66), p_rel, 'stop')])

        if K['solve']:
            # the keys of the hand's turn as (time, chest-frame turn, its palm); the forearm-relative
            # parts of each are found per frame in solved() (the arm needs the frame's chest)
            o_keys = dict(dip=(T(0.10), dip_q @ main_a.hand), rise=(T(0.24), rise_q), port=(T(0.34), port_q), over=(T(0.48), over_q),
                          rel=(T(0.66), q_rel))
            o_keys.update({k: (T(v[0]), Quaternion(v[1]) if len(v[1]) == 4 else basis_quat(Vector(v[1][:3]), Vector(v[1][3:])) @ main_a.hand)
                           for k, v in K.get('extra', {}).items()})
            o_use = sorted((o_keys[k] for k in K.get('okeys', ('dip', 'port', 'over', 'rel'))), key=lambda k: k[0])
            parts_cache = {}

            def parts():
                # per orientation key: (time, twist about the forearm in rad, wrist swing), the twist
                # unwrapped onto the branch nearest the key before it (or, `lin`, onto a straight run)
                if 'k' in parts_cache:
                    return parts_cache['k']
                out = []
                for t_k, q_k in o_use:
                    i = int(round(t_k * FPS))
                    F = self._forearm(i, hand_a_pos(t_k), q_k, pole_r(t_k))
                    tw, sw = self._parts(F.inverted() @ q_k)
                    lim = K.get('swing', 180.0) * DEG
                    if sw.angle > lim and t_k not in (o_use[0][0], o_use[-1][0]):
                        sw = Quaternion().slerp(sw, lim / sw.angle)
                    if out:
                        tw += 2 * math.pi * round((out[-1][1] - tw) / (2 * math.pi))
                    out.append([t_k, tw, sw])
                wind = K.get('wind', 0.0) * DEG  # (a whole turn added at the let-go, to choose the branch)
                if wind:
                    out[-1][1] += wind
                if K.get('lin'):
                    t0, t1 = out[0][0], out[-1][0]
                    for k in out[1:-1]:
                        k[1] = out[0][1] + (out[-1][1] - out[0][1]) * (k[0] - t0) / (t1 - t0)
                for k, v in K.get('twist_at', {}).items():  # (fitting: a key's twist given outright, deg from the dip's)
                    for o in out:
                        if abs(o[0] - T(k)) < 1e-6:
                            o[1] = out[0][1] + v * DEG
                parts_cache['k'] = out
                if DEBUG is not None and K.get('scan'):
                    t_r = T(0.66)
                    i_r = int(round(t_r * FPS))
                    tw_dip = out[0][1]
                    for lift in K.get('scan_lifts', (0.16, 0.24, 0.32)):
                        for off in K.get('scan_offs', (-0.04, 0.0, 0.04)):
                            for phi in K.get('scan_phis', range(-90, 91, 15)):
                                at = s_at - muzzle * lift + Vector((0, 0.0, -0.04 + off))
                                pq = hand_at(a, main_a, (at, s_q @ Quaternion((0, 0, 1), phi * DEG)))
                                sv = self._swivel(i_r, pq[0], pq[1], pole_r(t_r), step=10)
                                best = min(sv, key=lambda r: r[1])
                                at0 = [r for r in sv if r[0] == 0][0]
                                d0 = at0[2] - math.degrees(tw_dip); d0 -= 360 * round(d0 / 360)
                                db = best[2] - math.degrees(tw_dip); db -= 360 * round(db / 360)
                                DEBUG.append(('scan', a.gun, lift, off, phi, 'pole0 swing %.0f tw %+.0f' % (at0[1], d0), 'best sv %d swing %.0f tw %+.0f' % (best[0], best[1], db)))
                if DEBUG is not None:
                    for t_k, q_k in o_use:
                        sv = self._swivel(int(round(t_k * FPS)), hand_a_pos(t_k), q_k, pole_r(t_k))
                        best = min(sv, key=lambda r: r[1])
                        DEBUG.append(('swivel', a.gun, round(t_k * FPS, 1), 'at0', [r for r in sv if r[0] == 0][0], 'best', best))
                    DEBUG.append(('keys', a.gun, [(round(k[0] * FPS, 1), round(math.degrees(k[1])), round(math.degrees(k[2].angle))) for k in out]))
                return out

            def solved(t, i=None):
                # (t: the path's own time; i: the frame whose chest the arm hangs from)
                ks = parts()
                tw = Keys([(k[0], k[1]) + (('stop',) if j in (0, len(ks) - 1) else ()) for j, k in enumerate(ks)])(t)
                sw = QKeys([(k[0], k[2]) for k in ks])(t)
                W = sw @ Quaternion((0, 1, 0), tw)
                p = hand_a_pos(t)
                q = gun_a_hand(t)
                i = int(round(t * FPS)) if i is None else i
                for _ in range(3):
                    q = self._forearm(i, p, q, pole_r(t)) @ W
                return p, q

            t_a0, t_a1 = T(0.10), T(0.66)
            warp_cache = {}

            def warp(t):
                # (`warp`: the whole way from the dip to the let-go run on ONE minimum-jerk ease of how far
                # the gun travels along it (its muzzle, and its butt at half weight), so the gun's pace
                # rises and falls once; t -> the path's own time)
                if not K.get('warp') or not (t_a0 < t < t_a1):
                    return t
                if 'u' not in warp_cache:
                    n = 80
                    taus = [t_a0 + (t_a1 - t_a0) * j / n for j in range(n + 1)]
                    pts = []
                    for tau in taus:
                        at, q = self.by_hand(a, main_a, *(keyed(tau) if (K.get('resample') or K.get('chest')) else solved(tau)))
                        pts.append((at + q @ Vector((0, 0, -0.8)), at))
                    s_k = [0.0]
                    for (m0, b0), (m1, b1) in zip(pts, pts[1:]):
                        s_k.append(s_k[-1] + (m1 - m0).length + 0.5 * (b1 - b0).length)
                    warp_cache['u'] = (taus, s_k)
                taus, s_k = warp_cache['u']
                x = (t - t_a0) / (t_a1 - t_a0)
                ease_k = K.get('warpEase', 'minjerk')
                goal = s_k[-1] * (min_jerk(x) if ease_k == 'minjerk' else ease(x))
                j = max(0, min(len(s_k) - 2, next((j for j in range(len(s_k) - 1) if s_k[j + 1] >= goal), len(s_k) - 2)))
                f = (goal - s_k[j]) / max(1e-9, s_k[j + 1] - s_k[j])
                return taus[j] + (taus[j + 1] - taus[j]) * f
            self._warp = warp

            resampled = {}

            def keyed(t):
                # (`resample`: the forearm-relative turn taken only at a few times along the way (shares
                # of it) and the hand's turn joined through them as ordinary keys (chest frame): the
                # winding is the solved one, the gun's spin as even as the keys)
                if 'q' not in resampled and K.get('chest'):
                    # (`chest`: the named keys only, joined in the chest's frame as before, e.g. without
                    # the rise and the port; `chestQ`: extra orientation keys {share: (muzzle, top)})
                    pos_k = dict(dip=p_dip, rise=Vector((-0.3, 0.08, 0.4)), port=Vector((-0.34, 0.18, 0.36)), over=Vector((-0.33, 0.46, 0.04)), rel=p_rel)
                    pos_k.update({k: Vector(v) for k, v in K.get('chestP', {}).items()})
                    names = K['chest']
                    ts = [o_keys[n][0] for n in names]
                    resampled['p'] = Keys([(o_keys[n][0], pos_k[n]) + (('stop',) if j in (0, len(names) - 1) else ()) for j, n in enumerate(names)])
                    qk = [(o_keys[n][0], o_keys[n][1]) for n in names]
                    for x, (mz, tp) in K.get('chestQ', {}).items():
                        qk.append((t_a0 + (t_a1 - t_a0) * x, basis_quat(Vector(mz), Vector(tp)) @ main_a.hand))
                    if K.get('long'):
                        # (`long`: the hand turned from the dip to the let-go about ONE axis, the long way
                        # round (the other way would wind the forearm a whole turn): orientation keys at
                        # those shares, plus `longRoll` degrees about the forearm's way given at the middle)
                        q0k, q1k = qk[0][1], qk[-1][1]
                        d = q0k.inverted() @ q1k
                        if d.w < 0:
                            d.negate()
                        ang, ax = d.angle, d.axis
                        qk = [qk[0]] + [(t_a0 + (t_a1 - t_a0) * x, q0k @ Quaternion(ax, (ang - 2 * math.pi) * x)) for x in K['long']] + [qk[-1]]
                    qk.sort(key=lambda k: k[0])
                    resampled['q'] = QKeys([(tk, q) + (('stop',) if j in (0, len(qk) - 1) else ()) for j, (tk, q) in enumerate(qk)])
                if 'q' not in resampled:
                    xs = [0.0] + list(K['resample']) + [1.0]
                    ts = [t_a0 + (t_a1 - t_a0) * x for x in xs]
                    ks = [(tk, solved(tk)[1]) for tk in ts]
                    if K.get('through'):
                        # (`through`: the gun does not stop where the hand lets it go: the same curves run
                        # on into its sling place, which it reaches at rest at T(through))
                        t_s = T(K['through'])
                        p_s, q_s = hand_at(a, main_a, (s_at, s_q))
                        ks.append((t_s, q_s))
                        pk = [k for k in hand_a_pos.keys if k[0] > t_a0 - 1e-6]
                        pk = [(k[0], k[1]) + (('stop',) if j == 0 else ()) for j, k in enumerate(pk)]
                        resampled['p'] = Keys(pk + [(t_s, p_s, 'stop')])
                        resampled['q'] = QKeys([(tk, q) + (('stop',) if j in (0, len(ks) - 1) else ()) for j, (tk, q) in enumerate(ks)])
                    else:
                        resampled['q'] = QKeys([(tk, q) + (('stop',) if j in (0, len(ks) - 1) else ()) for j, (tk, q) in enumerate(ks)])
                        resampled['p'] = hand_a_pos
                return resampled['p'](t), resampled['q'](t)

        def gun_a(t):
            if K['solve'] and K.get('through') and T(0.10) <= t:
                if t >= T(K['through']):
                    return s_at.copy(), s_q.copy()
                return self.by_hand(a, main_a, *keyed(warp(t)))
            if K['solve'] and T(0.10) <= t <= T(0.66):
                if K.get('resample') or K.get('chest'):
                    p, q = keyed(warp(t))
                else:
                    p, q = solved(warp(t), int(round(t * FPS)))
                return self.by_hand(a, main_a, p, q)
            if t <= T(0.66):
                p, q = hand_a_pos(t), gun_a_hand(t)
                return self.by_hand(a, main_a, p, q)
            # on the sling: it drops the last 24 cm into place, swings a little past and settles
            x = arrive(span(t, T(0.66), T(0.84)), 0.12)
            if K['solve']:  # (and settles flat on the back as it drops, its let-go roll taken out)
                return rel_at.lerp(s_at, x), rel_q.slerp(s_q, min(1.0, ease(span(t, T(0.66), T(0.66) + K.get('settle', 0.12)))))
            return rel_at.lerp(s_at, x), s_q

        # the incoming gun, by where the support hand takes it
        b_at, b_q = stow_b
        pb0, qb0 = hand_at(b, draw_b, (b_at, b_q))
        b_muzzle = b_q @ Vector((0, 0, -1))
        pb1 = pb0 + b_muzzle * 0.06 + Vector((0.1, 0.03, -0.03))  # pulled off the back, out to the left
        trail_q = basis_quat(Vector((-0.2, -0.45, 0.87)), Vector((0.15, 1.0, 0.1))) @ draw_b.hand
        level_q = basis_quat(Vector((-0.1, 0.25, 0.96)), Vector((0.2, 1.0, -0.2))) @ draw_b.hand
        up_q = basis_quat(*self.PORT[b.gun]) @ draw_b.hand
        # (poses given by where the gun is, to keep its butt out of the body on the way: low past
        # the outside of the left hip, then in front of the chest as the muzzle comes down)
        # (per body, `swapShift`: the incoming gun's way up and to the front brought nearer the chest
        # (chest frame), for shoulders further back than the old body's)
        SH = Vector(body.T.get('swapShift', (0.0, 0.0, 0.0)))
        pb_swing, qb_swing = hand_at(b, draw_b, (Vector((0.36, -0.42, 0.14)) + SH - b.shift, basis_quat(Vector((-0.1, 0.7, 0.7)), Vector((0.25, 0.5, -0.7)))))
        # the low ready, by the draw hold (the support hand rolls from there to its place later)
        pb_end, qb_end = hand_at(b, draw_b, (low_at, low_q))
        tip_q = (up_q @ draw_b.hand.inverted()).slerp(low_q, 0.3)
        pb_tip, qb_tip = hand_at(b, draw_b, (Vector((-0.12, 0.04, 0.18)) + SH - b.shift, tip_q))
        # The butt cannot swing round to the front at hip height (it would pass through the body):
        # the gun swings up at the left side like a pendulum, muzzle forward then up, so the butt
        # goes down past the outside of the hip and comes up in front of the belly, the gun upright
        # before the chest (port), where the firing hand takes its grip; both hands then bring the
        # muzzle down into the low ready.
        gun_b_hand = QKeys([(T(0.0), qb0), (T(0.34), qb0, 'stop'), (T(0.44), b_q @ draw_b.hand), (T(0.54), trail_q), (T(0.62), level_q),
                            (T(0.70), qb_swing), (T(0.78), up_q), (T(0.86), up_q), (T(0.93), qb_tip), (T(1.0), qb_end, 'stop'), (T(1.06), qb_end), (T(1.2), qb_end)])
        hand_b_pos = Keys([(T(0.0), pb0), (T(0.34), pb0, 'stop'), (T(0.44), pb1), (T(0.54), Vector((0.33, -0.25, 0.2)) + SH),
                           (T(0.62), Vector((0.32, -0.12, 0.3)) + SH), (T(0.70), pb_swing), (T(0.78), Vector((0.12, 0.3, 0.4)) + SH),
                           (T(0.86), Vector((0.11, 0.31, 0.41)) + SH), (T(0.93), pb_tip), (T(1.0), pb_end + Vector((0.0, -0.008, 0.014)), 'stop'), (T(1.12), pb_end, 'stop'), (T(1.2), pb_end)])
        def gun_b(t):
            if t <= T(0.34):
                return b_at.copy(), b_q.copy()
            return self.by_hand(b, draw_b, hand_b_pos(t), gun_b_hand(t))

        def guns(t):
            return {'gun': gun_a(t), 'gun2': gun_b(t)}

        # (`regrip` per incoming gun: when the support hand slides from the fore-end to its place)
        rg = (K.get(b.gun, {}).get('regrip') if UNWIND else None) or (0.56, 0.96)
        hands = {
            'Right': Hand('Right', [
                ('hold', T(0.0), T(0.66), 'gun', main_a),
                ('move', T(0.66), T(0.86), [Vector(v) for v in K.get('via', ((-0.3, 0.36, -0.04), (-0.16, 0.16, 0.3)))], 0.012, K.get('swapRoll', SWAP_ROLL))
                + (('forearm',) if K.get('freeForearm') else ()),
                ('hold', T(0.86), self.SECONDS, 'gun2', main_b),
            ]),
            'Left': Hand('Left', [
                ('hold', T(0.0), T(0.08), 'gun', sup_a),
                ('move', T(0.08), T(0.34), [Vector((0.3, -0.12, 0.08)), Vector((0.27, -0.24, -0.1))], 0.01),
                ('hold', T(0.34), T(0.56), 'gun2', draw_b),
                # (the hand rolls round under the fore-end into its place as the gun comes up)
                ('hold', T(0.56), T(rg[1]), 'gun2', Spot.regrip(draw_b, sup_b, T(rg[0]), T(rg[1]))),
                ('hold', T(rg[1]), self.SECONDS, 'gun2', sup_b),
            ]),
        }
        pole_r = QKeysV([(T(0.0), a.pole['Right']), (T(0.14), a.pole['Right']), (T(0.32), Vector((-0.75, -0.6, 0.0))),
                         (T(0.48), Vector((-0.9, 0.45, 0.05))), (T(0.64), Vector((-0.45, 0.85, 0.2))), (T(0.69), Vector((-0.35, 0.3, 0.89))), (T(0.78), Vector((-0.55, -0.7, 0.45))),
                         (T(0.8), Vector((-0.6, -0.7, 0.4))), (T(0.9), Vector((-0.6, -0.7, 0.3))), (T(1.0), b.pole['Right']), (T(1.2), b.pole['Right'])])
        pole_l = QKeysV([(T(0.0), a.pole['Left']), (T(0.1), a.pole['Left']), (T(0.22), Vector((0.75, -0.35, -0.5))),
                         (T(0.32), Vector((0.65, -0.2, -0.75))), (T(0.5), Vector((0.8, -0.3, -0.5))), (T(0.62), Vector((0.85, -0.5, 0.0))),
                         (T(0.86), b.pole['Left']), (T(1.2), b.pole['Left'])])

        def paused(t):  # (pass A3: the firing elbow keeps to the hand's pace through its rest at `slung`)
            ta, tb = T(0.66), T(0.86)
            if UNWIND and ta < t < tb:
                return ta + pause_pace((t - ta) / (tb - ta), (T(0.76) - ta) / (tb - ta)) * (tb - ta)
            return t

        def poles(t):
            if K['solve'] and K.get('warp'):  # (the firing elbow keeps to the gun's warped pace)
                return {'Right': pole_r(warp(t)), 'Left': pole_l(t)}
            return {'Right': pole_r(paused(t)), 'Left': pole_l(t)}

        curl_r = Keys([(T(0.0), 1.0), (T(0.64), 1.0), (T(0.7), 0.45), (T(0.8), 0.35), (T(0.86), 1.0, 'stop'), (T(1.2), 1.0)])
        curl_l = Keys([(T(0.0), 1.0), (T(0.08), 1.0), (T(0.16), 0.3), (T(0.28), 0.35), (T(0.34), 0.95, 'stop'), (T(0.6), 0.95),
                       (T(0.74), 0.75), (T(0.92), 1.0, 'stop'), (T(1.2), 1.0)])

        def curl(t):
            return {'Right': curl_r(t), 'Left': curl_l(t)}

        lean = Keys([(T(0.0), 0.0), (T(0.12), 2.0, 'stop'), (T(0.32), -1.5), (T(0.55), 2.5), (T(0.8), 2.0), (T(1.0), -0.6), (T(1.2), 0.0)])
        turn = Keys([(T(0.0), 0.0), (T(0.12), -3.0, 'stop'), (T(0.32), 16.0), (T(0.52), 9.0), (T(0.8), -3.0), (T(1.0), 1.2), (T(1.2), 0.0)])
        roll = Keys([(T(0.0), 0.0), (T(0.3), -5.0), (T(0.5), -2.0), (T(0.85), 1.0), (T(1.2), 0.0)])
        look_yaw = Keys([(T(0.0), 0.0), (T(0.18), 0.0), (T(0.36), 28.0), (T(0.6), 22.0), (T(0.82), 6.0), (T(1.05), 0.0), (T(1.2), 0.0)])
        look_pitch = Keys([(T(0.0), 0.0), (T(0.18), 0.0), (T(0.38), 14.0), (T(0.65), 10.0), (T(0.85), 14.0), (T(1.05), 2.0), (T(1.2), 0.0)])
        dip = Keys([(T(0.0), 0.0), (T(0.12), 0.012, 'stop'), (T(0.4), 0.004), (T(0.7), 0.006), (T(0.98), 0.008), (T(1.2), 0.0)])
        sway = Keys([(T(0.0), 0.0), (T(0.35), 0.012), (T(0.7), 0.004), (T(1.2), 0.0)])
        collar_r = Keys([(T(0.0), Vector((0.0, 0.0))), (T(0.3), Vector((-4.0, -6.0))), (T(0.46), Vector((-6.0, -12.0))), (T(0.56), Vector((-4.0, -8.0))),
                         (T(0.8), Vector((0.0, 0.0))), (T(1.2), Vector((0.0, 0.0)))])
        collar_l = Keys([(T(0.0), Vector((0.0, 0.0))), (T(0.25), Vector((8.0, 4.0))), (T(0.45), Vector((6.0, 3.0))), (T(0.8), Vector((0.0, 0.0))),
                         (T(1.2), Vector((0.0, 0.0)))])
        reach_l = K.get(b.gun, {}).get('reachCollar') if UNWIND else None
        if reach_l:  # (the support shoulder drawn forward as that hand reaches the incoming gun's fore-end)
            collar_l = Keys([(T(0.0), Vector((0.0, 0.0))), (T(0.25), Vector((8.0, 4.0))), (T(0.45), Vector((6.0, 3.0))), (T(0.72), Vector((0.0, 0.0))),
                             (T(0.9), Vector(reach_l)), (T(1.06), Vector((0.0, 0.0))), (T(1.2), Vector((0.0, 0.0)))])

        def trunk(t):
            cr, cl = collar_r(t), collar_l(t)
            return dict(lean=lean(t), turn=turn(t), roll=roll(t), look_yaw=look_yaw(t), look_pitch=look_pitch(t), dip=dip(t),
                        sway=sway(t), collar={'clavicle_r': (cr.x, cr.y), 'clavicle_l': (cl.x, cl.y)})

        # (pass A3) the firing hand comes to rest at `slung` on its way back over the shoulder: the game's stow ends
        # there and its draw starts there (the hand stopped from 3.4 to 3.9 m/s in one frame)
        if UNWIND:  # (Tripo, with F3's forearm solve; the other bodies keep the earlier timing: without that solve the
            # pause put a 94 deg twist step into their forearm)
            self.pause = {'Right': (T(0.76), T(0.66), T(0.86))}
        frames, meta = self.build(self.SECONDS, trunk, guns, hands, poles, curl)
        meta['events'] = {'letGo': round(T(0.1), 3), 'raise': round(T(0.14), 3), 'draw': round(T(0.34), 3), 'slung': round(T(0.76), 3), 'handOver': round(T(0.86), 3), 'end': self.SECONDS}
        meta['nodes'] = ['GunIn', 'PalmL', 'PalmR', 'ElbowL', 'ElbowR']
        return frames, meta


def smooth_poses(poses, sigma):
    """(position, rotation) per frame, each blended with its neighbours (Gaussian, the ends held)."""
    n = len(poses)
    r = int(math.ceil(3 * sigma))
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    out = []
    for i in range(n):
        ref = poses[i][1]
        pos, q, total = Vector(), Vector((0, 0, 0, 0)), 0.0
        for k in range(-r, r + 1):
            p, rq = poses[min(n - 1, max(0, i + k))]
            v = Vector(rq)
            if v.dot(Vector(ref)) < 0:
                v = -v
            pos += p * w[k + r]
            q += v * w[k + r]
            total += w[k + r]
        out.append((pos / total, Quaternion(q / total).normalized()))
    return out


def two_bone(root, target, l1, l2, pole):
    """The middle joint of a two-bone chain from root towards target, bent towards pole (the game's
    and the rig's solve)."""
    a = target - root
    dist = a.length
    reach = min(max(dist, abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999)
    a = a.normalized() if dist > 1e-6 else Vector((0, -1, 0))
    along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach)
    out = math.sqrt(max(0.0, l1 * l1 - along * along))
    b = pole - root
    b = b - a * b.dot(a)
    b = b.normalized() if b.length > 1e-6 else Vector((0, -1, 0))
    return root + a * along + b * out


class QKeysV:
    """Directions at times (unit Vectors), joined by curves and kept unit length."""

    def __init__(self, keys):
        self.keys = Keys([(k[0], Vector(k[1]).normalized(), *k[2:]) for k in keys])

    def __call__(self, t):
        return self.keys(t).normalized()


class RifleReload(Clip):
    """The rifle's magazine change, with rounds left (tactical) or from empty, which then pulls the
    charging handle.

      0.00  the low ready; the gun dips (anticipation) and is brought in to the chest, muzzle a
            little down, rolled so the magazine well faces the support hand; the eyes go to it
      0.10  the support hand leaves the handguard and comes under the gun to the magazine
      0.44  ... pulls it out (it is clear at 0.60) and lets it fall, then goes to the belt pouch
      1.02  a fresh magazine in the hand; up on an arc out and round to the well, front first
      1.56  under the well; pushed home (seated 1.72) with a punch that shows on the gun
      1.84  the hand lets go and goes back to the handguard, a little past and back, while the gun
            rolls level and goes back to the low ready and the eyes come up
    From empty, after the magazine is seated the hand goes up to the charging handle (2.14),
    pulls it back (2.32) and lets it go (2.37), and only then returns.
    """

    def __init__(self, author, carry, carry2, stance, empty):
        super().__init__(author, carry, carry2, stance)
        self.empty = empty

    def mag_spot(self, slide):
        """The palm on the magazine slid `slide` out of the well (gun frame)."""
        def at(t):
            return Spot(self.mag_rest + MAG_PALM - Vector((0, slide(t), 0)), MAG_HAND)
        return at

    def make(self):
        c, empty = self.carry, self.empty
        self.mag_rest = c.parts['magazine']
        end = 2.95 if empty else 2.3
        main, sup = self.spot(c, 'main'), self.spot(c, 'support')
        low_at, low_q = self.low()
        back0 = 2.46 if empty else 1.84  # the hand heads back to the handguard
        # the gun: in to the chest and rolled for the work, punches at the magazine's going and
        # coming, then back out to the low ready (from empty, rolled back level for the handle first)
        work_at, work_q = Vector((-0.08, 0.11, 0.22)), gun_quat(32, 16, 32)
        keys_at = [(0.0, low_at), (0.1, low_at + Vector((0.0, -0.012, 0.004)), 'stop'), (0.34, work_at),
                   (0.6, work_at + Vector((0.0, -0.01, 0.0))), (0.7, work_at), (1.5, work_at + Vector((0.01, 0.01, -0.01))),
                   (1.74, work_at + Vector((0.0, 0.016, 0.0))), (1.84, work_at)]
        keys_q = [(0.0, low_q), (0.1, gun_quat(46, 34, -8), 'stop'), (0.34, work_q), (0.6, gun_quat(32, 19, 30)), (0.7, work_q),
                  (1.5, gun_quat(30, 14, 34)), (1.74, gun_quat(32, 12, 32)), (1.84, work_q)]
        if empty:
            keys_at += [(2.1, Vector((-0.1, 0.13, 0.2))), (2.37, Vector((-0.1, 0.13, 0.2)) + Vector((0, 0, -0.012))), (2.45, Vector((-0.1, 0.13, 0.2)))]
            keys_q += [(2.1, gun_quat(36, 10, 8)), (2.37, gun_quat(36, 8, 8)), (2.45, gun_quat(36, 10, 8))]
        keys_at += [(end - 0.12, low_at + Vector((0.0, 0.006, 0.006))), (end, low_at, 'stop')]
        keys_q += [(end - 0.12, gun_quat(46, 29, -9)), (end, low_q, 'stop')]
        gun_at, gun_q = Keys(keys_at), QKeys(keys_q)
        stow = self.stow(self.carry2)

        def guns(t):
            return {'gun': (gun_at(t), gun_q(t)), 'gun2': stow}

        def pull(t):  # the magazine's slide out of the well, then back in with a punch
            if t < 0.44:
                return 0.0
            if t < 1.0:
                return MAG_TRAVEL * span(t, 0.44, 0.6) ** 2
            if t < 1.56:
                return MAG_TRAVEL
            x = span(t, 1.56, 1.72)
            return MAG_TRAVEL * (1 - (1 - (1 - x) ** 2)) - 0.003 * math.sin(math.pi * span(t, 1.68, 1.8))

        def pulled(t):  # the handle
            if not empty:
                return 0.0
            return HANDLE_TRAVEL * ease(span(t, 2.14, 2.32)) * (1 - span(t, 2.32, 2.37))

        mag_out = self.mag_spot(pull)
        handle = lambda t: Spot(c.parts['charging_handle'] + Vector((-0.02, 0, 0.012 + pulled(t))), hand_quat((0.9, 0, 0.35), (0, 0.4, 0.92)), loose=True)
        left = [
            ('hold', 0.0, 0.1, 'gun', sup),
            ('move', 0.1, 0.36, [Vector((0.06, -0.12, 0.3))], 0.008),
            ('hold', 0.36, 0.62, 'gun', mag_out),
            ('move', 0.62, 0.98, [Vector((0.16, -0.26, 0.22))], 0.01),
            ('hold', 0.98, 1.1, self.pouch, None),
            ('move', 1.1, 1.52, [Vector((0.2, -0.2, 0.3))], 0.006),
            ('hold', 1.52, 1.84, 'gun', mag_out),
        ]
        if empty:
            left += [('move', 1.84, 2.14, [Vector((0.02, 0.1, 0.32))], 0.006),
                     ('hold', 2.14, 2.4, 'gun', handle)]
        left += [('move', back0 if not empty else 2.4, end - 0.06, [Vector((0.08, -0.06, 0.4))], 0.012) + ((EMPTY_ROLL,) if empty else ()),
                 ('hold', end - 0.06, end, 'gun', sup)]
        hands = {'Left': Hand('Left', left), 'Right': Hand('Right', [('hold', 0.0, end, 'gun', main)])}
        pole_l = QKeysV([(0.0, c.pole['Left']), (0.1, c.pole['Left']), (0.36, Vector((0.5, -0.85, 0.1))), (0.8, Vector((0.7, -0.7, -0.1))),
                         (1.05, Vector((0.75, -0.6, -0.2))), (1.5, Vector((0.5, -0.85, 0.1))), (1.84, Vector((0.5, -0.85, 0.1)))]
                        + ([(2.2, Vector((0.6, -0.5, 0.3))), (2.4, Vector((0.6, -0.5, 0.3)))] if empty else [])
                        + [(end - 0.1, c.pole['Left']), (end, c.pole['Left'])])

        def poles(t):
            return {'Left': pole_l(t), 'Right': c.pole['Right']}

        curl_l = Keys([(0.0, 1.0), (0.1, 1.0), (0.2, 0.4), (0.32, 0.5), (0.4, 0.9, 'stop'), (0.62, 0.9), (0.68, 0.3), (0.94, 0.35),
                       (1.02, 0.9, 'stop'), (1.5, 0.9), (1.8, 0.85), (1.9, 0.4)]
                      + ([(2.1, 0.5), (2.16, 0.9, 'stop'), (2.36, 0.9), (2.42, 0.4)] if empty else [])
                      + [(end - 0.1, 0.5), (end, 1.0, 'stop')])

        def curl(t):
            return {'Left': curl_l(t), 'Right': 1.0}

        up = 2.1 if empty else 1.8  # the eyes come back up
        look_p = Keys([(0.0, 0.0), (0.12, 0.0), (0.4, 24.0), (0.8, 20.0), (1.1, 24.0), (1.5, 26.0), (up, 18.0 if empty else 22.0),
                       (end - 0.2, 0.0), (end, 0.0)])
        look_y = Keys([(0.0, 0.0), (0.12, 0.0), (0.4, 12.0), (0.9, 18.0), (1.5, 10.0), (up, 6.0), (end - 0.2, 0.0), (end, 0.0)])
        lean = Keys([(0.0, 0.0), (0.1, 1.5, 'stop'), (0.4, 4.0), (0.62, 5.0), (1.0, 3.0), (1.6, 4.5), (1.74, 5.0), (up, 3.0), (end - 0.15, -0.6), (end, 0.0)])
        turn = Keys([(0.0, 0.0), (0.1, -2.0, 'stop'), (0.4, 6.0), (1.0, 9.0), (1.5, 6.0), (up, 4.0), (end - 0.15, -1.0), (end, 0.0)])
        roll = Keys([(0.0, 0.0), (0.4, 2.0), (1.0, -3.0), (1.5, 1.0), (end, 0.0)])
        dip = Keys([(0.0, 0.0), (0.1, 0.01, 'stop'), (0.6, 0.006), (1.0, 0.014), (1.6, 0.008), (end - 0.15, 0.004), (end, 0.0)])
        collar_l = Keys([(0.0, Vector((0.0, 0.0))), (0.4, Vector((-4.0, -2.0))), (1.0, Vector((4.0, -4.0))), (1.5, Vector((-4.0, 0.0))),
                         (end - 0.15, Vector((0.0, 0.0))), (end, Vector((0.0, 0.0)))])

        def trunk(t):
            cl = collar_l(t)
            return dict(lean=lean(t), turn=turn(t), roll=roll(t), look_yaw=look_y(t), look_pitch=look_p(t), dip=dip(t),
                        collar={'clavicle_l': (cl.x, cl.y)})

        def props(t, f):
            out = {'handle': pulled(t)}
            if 0.62 < t < 1.06:
                out['mag'] = ('gone',)
            elif t <= 0.62 or t >= 1.52:
                out['mag'] = ('well', pull(t))
            else:
                # in the hand: the magazine's turn and origin from the hand (weapon.js carried)
                wrist, hq = f['hands']['Left']
                palm = wrist + hq @ PALM_LOCAL
                mq = hq @ MAG_HAND.inverted()
                out['mag'] = ('free', palm - mq @ MAG_PALM, mq)
            return out

        frames, meta = self.build(end, trunk, guns, hands, poles, curl, props)
        meta['events'] = {'magOut': 0.44, 'magFree': 0.6, 'magPouch': 1.06, 'magWell': 1.56, 'magIn': 1.72, 'letGo': 1.84, 'end': end}
        if empty:
            meta['events'].update(boltBack=2.32, boltForward=2.37)
        meta['nodes'] = ['PalmL', 'PalmR', 'ElbowL', 'ElbowR']
        return frames, meta


class ShotgunHandling(Clip):
    """The shotgun's reload, a shell at a time, and its pump stroke.

    The reload is three clips the game chains: `reload-shotgun-start` brings the gun in and rolls
    it over so the loading port under the receiver faces the support hand, which comes off the
    pump to the port; `reload-shotgun-shell`, played once a shell, takes a shell from the belt,
    carries it on an arc to the port and thumbs it in (shellIn), the hand back at the port, where
    the next one starts; `reload-shotgun-end` takes the hand back to the pump and the gun out to
    the low ready, and `reload-shotgun-end-pump` (from empty) racks the pump on the way. All three
    meet in the same pose (the gun rolled, the eyes on the port, the hand open at the port), so the
    trigger can break off after any shell. `shotgun-pump` is the stroke after a shot: the hand
    drives the pump back and forward, the gun rocks back and settles.
    """

    WORK_AT, WORK_Q = Vector((-0.11, 0.08, 0.2)), (30, 18, 50)
    # the trunk and the eyes at the work (degrees, on top of the hold's)
    WORK = dict(lean=4.0, turn=6.0, look_pitch=24.0, look_yaw=12.0, dip=0.008)
    PUMP = dict(wait=0.14, back=0.3, forward=0.48)  # shotgun.js PUMP (s)

    def __init__(self, author, carry, carry2, stance, part):
        super().__init__(author, carry, carry2, stance)
        self.part = part

    def port_spot(self):
        return Spot(self.carry.parts['port'] + Vector((-0.005, -0.034, 0)), PORT_HAND, loose=True)

    def pump_spot(self, travel):
        sup = self.spot(self.carry, 'support')
        return lambda t: Spot(sup.palm + Vector((0, 0, travel(t))), sup.hand)

    def trunk_keys(self, keys):
        """keys: [(t, share of the work pose 0..1, extra lean)] -> trunk(t)."""
        share = Keys([(k[0], k[1]) for k in keys])
        extra = Keys([(k[0], k[2]) for k in keys])

        def trunk(t):
            w = share(t)
            out = {k: v * w for k, v in self.WORK.items()}
            out['lean'] += extra(t)
            return out
        return trunk

    def stroke(self, t0):
        """The pump's travel for a stroke starting at t0 (shotgun.js stroke)."""
        p = self.PUMP

        def travel(t):
            x = t - t0
            if x < p['wait']:
                return 0.0
            if x < p['back']:
                return PUMP_TRAVEL * ease(span(x, p['wait'], p['back']))
            return PUMP_TRAVEL * (1 - ease(span(x, p['back'], p['forward'])))
        return travel

    def make(self):
        c = self.carry
        low_at, low_q = self.low()
        work = (self.WORK_AT, gun_quat(*self.WORK_Q))
        main, sup, port = self.spot(c, 'main'), self.spot(c, 'support'), self.port_spot()
        stow = self.stow(self.carry2)
        none = lambda t: 0.0
        part = self.part
        events, shell, pump = {}, None, none
        if part == 'start':
            end = 0.4
            gun_at = Keys([(0.0, low_at), (0.08, low_at + Vector((0, -0.01, 0.004)), 'stop'), (0.36, work[0]), (end, work[0])])
            gun_q = QKeys([(0.0, low_q), (0.08, gun_quat(46, 34, -8), 'stop'), (0.36, work[1]), (end, work[1])])
            left = [('hold', 0.0, 0.06, 'gun', sup), ('move', 0.06, 0.36, [Vector((0.1, -0.12, 0.3))], 0.008), ('hold', 0.36, end, 'gun', port)]
            trunk = self.trunk_keys([(0.0, 0.0, 0.0), (0.08, 0.1, 1.0), (0.36, 1.0, 0.4), (end, 1.0, 0.0)])
            curl_l = Keys([(0.0, 1.0), (0.06, 1.0), (0.16, 0.4), (0.36, 0.55), (end, 0.55)])
            pole_l = QKeysV([(0.0, c.pole['Left']), (0.06, c.pole['Left']), (0.36, Vector((0.55, -0.8, 0.1))), (end, Vector((0.55, -0.8, 0.1)))])
        elif part == 'shell':
            end = 0.6
            bump = Keys([(0.0, 0.0), (0.48, 0.0), (0.54, 0.012), (end, 0.0, 'stop')])
            gun_at = lambda t: work[0] + Vector((0, bump(t), 0))
            gun_q = lambda t: work[1]
            seat = lambda t: ease(span(t, 0.46, 0.54))
            # the hand pushes up into the port with the shell, and comes back down
            push = lambda t: Spot(port.palm + Vector((0, 0.025 * math.sin(math.pi * span(t, 0.46, 0.6)), 0)), port.hand, loose=True)
            left = [('hold', 0.0, 0.02, 'gun', port), ('move', 0.02, 0.2, [Vector((0.16, -0.22, 0.2))], 0.006),
                    ('hold', 0.2, 0.27, self.pouch, None), ('move', 0.27, 0.46, [Vector((0.18, -0.12, 0.3))], 0.006),
                    ('hold', 0.46, end, 'gun', push)]
            trunk = self.trunk_keys([(0.0, 1.0, 0.0), (0.2, 1.0, -0.6), (0.46, 1.0, 0.6), (end, 1.0, 0.0)])
            curl_l = Keys([(0.0, 0.55), (0.12, 0.45), (0.2, 0.6), (0.25, 0.85, 'stop'), (0.46, 0.85), (0.54, 0.5), (end, 0.55)])
            pole_l = QKeysV([(0.0, Vector((0.55, -0.8, 0.1))), (0.2, Vector((0.75, -0.6, -0.2))), (0.46, Vector((0.55, -0.8, 0.1))),
                             (end, Vector((0.55, -0.8, 0.1)))])
            shell = (0.24, 0.56, seat)
            events = {'shellIn': 0.54}
        elif part in ('end', 'end-pump'):
            racked = part == 'end-pump'
            back = 0.36  # the hand is on the pump
            end = back + (0.62 if racked else 0.06)
            pump = self.stroke(back) if racked else none
            ka = [(0.0, work[0]), (0.04, work[0])]
            kq = [(0.0, work[1]), (0.04, work[1])]
            if racked:
                # (the gun comes level for the stroke, rocks back as the pump hits its stop)
                mid_at, mid_q = Vector((-0.13, 0.16, 0.15)), gun_quat(45, 28, -4)
                ka += [(back, mid_at), (back + 0.3, mid_at + Vector((0, 0.006, -0.012))), (back + 0.48, mid_at), (end - 0.08, low_at + Vector((0, 0.004, 0.004)))]
                kq += [(back, mid_q), (back + 0.3, gun_quat(45, 24, -4)), (back + 0.48, gun_quat(45, 30, -5)), (end - 0.08, gun_quat(46, 30, -8))]
            else:
                ka += [(end - 0.08, low_at + Vector((0, 0.006, 0.006)))]
                kq += [(end - 0.08, gun_quat(46, 29, -9))]
            gun_at = Keys(ka + [(end, low_at, 'stop')])
            gun_q = QKeys(kq + [(end, low_q, 'stop')])
            left = [('hold', 0.0, 0.02, 'gun', port), ('move', 0.02, back, [Vector((0.1, -0.14, 0.34))], 0.01),
                    ('hold', back, end, 'gun', self.pump_spot(pump))]
            trunk = self.trunk_keys([(0.0, 1.0, 0.0), (back, 0.4, 0.0)] + ([(back + 0.3, 0.2, -1.0), (back + 0.48, 0.1, 0.8)] if racked else [])
                                    + [(end, 0.0, 0.0)])
            curl_l = Keys([(0.0, 0.55), (0.12, 0.4), (back - 0.04, 0.6), (back, 1.0, 'stop'), (end, 1.0)])
            pole_l = QKeysV([(0.0, Vector((0.55, -0.8, 0.1))), (back, c.pole['Left']), (end, c.pole['Left'])])
            if racked:
                events = {'pumpBack': back + self.PUMP['back'], 'pumpForward': back + self.PUMP['forward']}
        else:  # 'pump': the stroke after a shot, from the low ready
            end = 0.6
            pump = self.stroke(0.0)
            gun_at = Keys([(0.0, low_at), (0.14, low_at), (0.3, low_at + Vector((0, 0.005, -0.012))), (0.48, low_at + Vector((0, -0.004, 0.004))),
                           (end, low_at, 'stop')])
            gun_q = QKeys([(0.0, low_q), (0.14, low_q), (0.3, gun_quat(45, 27, -8)), (0.48, gun_quat(46, 33, -8)), (end, low_q, 'stop')])
            left = [('hold', 0.0, end, 'gun', self.pump_spot(pump))]
            trunk = self.trunk_keys([(0.0, 0.0, 0.0), (0.3, 0.0, -0.8), (0.48, 0.0, 0.6), (end, 0.0, 0.0)])
            curl_l = Keys([(0.0, 1.0), (end, 1.0)])
            pole_l = QKeysV([(0.0, c.pole['Left']), (end, c.pole['Left'])])
            events = {'pumpBack': self.PUMP['back'], 'pumpForward': self.PUMP['forward']}

        def guns(t):
            return {'gun': (gun_at(t), gun_q(t)), 'gun2': stow}

        hands = {'Left': Hand('Left', left), 'Right': Hand('Right', [('hold', 0.0, end, 'gun', main)])}

        def props(t, f):
            out = {'pump': pump(t)}
            if shell and shell[0] <= t < shell[1]:
                wrist, hq = f['hands']['Left']
                palm = wrist + hq @ PALM_LOCAL
                at = palm + hq @ Vector((0, -0.02, 0.016))
                s = shell[2](t)
                port_at = f['gun']['butt'] + f['gun']['quat'] @ (self.carry.parts['port'] - self.carry.butt)
                out['shell'] = (at.lerp(port_at, s), f['gun']['quat'])
                out['seat'] = s
            return out

        frames, meta = self.build(end, trunk, guns, hands, lambda t: {'Left': pole_l(t), 'Right': c.pole['Right']},
                                  lambda t: {'Left': curl_l(t), 'Right': 1.0}, props)
        meta['events'] = dict(events, end=end)
        meta['nodes'] = ['PalmL', 'PalmR', 'ElbowL', 'ElbowR']
        return frames, meta


SHOTGUN_CLIPS = {
    'reload-shotgun-start': lambda *a: ShotgunHandling(*a, 'start'),
    'reload-shotgun-shell': lambda *a: ShotgunHandling(*a, 'shell'),
    'reload-shotgun-end': lambda *a: ShotgunHandling(*a, 'end'),
    'reload-shotgun-end-pump': lambda *a: ShotgunHandling(*a, 'end-pump'),
    'shotgun-pump': lambda *a: ShotgunHandling(*a, 'pump'),
}


class AimPose(Clip):
    """A shouldered pose, one frame: the gun level, or 45 degrees up or down, straight ahead.

    The trunk takes 40 % of the pitch (leaning back to aim up, over the gun to aim down) and
    turns a further 10 degrees from the carry's blade; the butt sits in the shoulder pocket; the
    gun's turn in the chest's frame is whatever is left over to
    point it. The head is then brought down to the gun until the aiming eye is behind the sight at
    the eye relief (weapon.js eyeLocal), the neck taking the turn and the head giving half of it
    back, so the face stays towards the target: the cheek weld. The hands hold the aiming grips
    (weapon.js / shotgun.js HAND.grip), the support hand free to turn about its palm on the fore-end
    to keep its wrist straight; the elbows go where the game's aiming poles put them.
    """

    # the shoulder pocket (character.js POCKET: x and y), 2.3 cm further out than the game reads it
    # off the rest-pose body: there the stock's toe went 2 to 3 cm into the chest and upper arm
    _A = body.T['aim']  # (per body: bodies/<body>.json `aim`)
    POCKET = Vector(_A['pocket'])
    EYE = {'rifle': Vector((0, 0.1126, -0.1584)), 'shotgun': Vector((0, 0.1301, -0.158))}  # eyeLocal, from the butt
    GRIP = {g: (Vector(v[0]), hand_quat(*v[1])) for g, v in _A['grip'].items()}
    # the support palm from grip_support: on the shotgun 10 cm back along the pump, where the arm
    # reaches it shouldered (shotgun.js AIM_SLIDE)
    SUPPORT = {g: Vector(v) for g, v in _A['support'].items()}
    POLE = {k: Vector(v) for k, v in _A['pole'].items()}  # character.js ELBOW_POLE
    UP_SLIDE = {'rifle': 0.025, 'shotgun': 0.035}  # m back along the fore-end, aimed 45 up
    SHARE = 0.4  # of the pitch taken by the trunk
    # where the eye sits for the weld, from weapon.js's eyeLocal: 6 cm further back and 4.5 cm higher,
    # and aimed 45 down 1.2 cm higher and 1 cm further back again (main.js CHEEK and CHEEK_DOWN, the
    # same), so the face comes to the gun nearly upright and only the cheek and jaw meet the comb
    EYE_BACK = Vector(_A['eyeBack'])
    EYE_DOWN = Vector(_A['eyeDown'])
    # the head leans over onto the stock only a little (top of the head towards the gun, degrees); the
    # gun comes up to the face instead (make), and the firing shoulder is raised to it (collarbone
    # roll, degrees)
    CANT = dict(_A['cant'])
    LIFT = Vector(_A['lift'])  # the butt from the pocket: up and in, to the face
    NOD = 6.0  # degrees the chin comes down
    HEAD_SHARE = 0.85  # of the pitch the trunk leaves, taken by the neck and head
    RAISE = -6.0
    DOWN_SLIDE = _A.get('downSlide', 0.0)  # m back along the fore-end, aimed 45 down (per body)
    LEAN = _A.get('lean', 0.0)  # degrees more forward lean of the trunk (per body: the head reaching the gun)
    TURN = -10.0  # degrees the chest turns further from the carry's blade (- = to the right)

    def __init__(self, author, carry, carry2, stance, pitch):
        super().__init__(author, carry, carry2, stance)
        self.pitch = pitch

    def make(self):
        c, p = self.carry, self.pitch
        # the head: nearly upright, chin a little down and forward, looking along the gun (the neck
        # takes what the trunk leaves of the pitch), and leaning over onto the stock by CANT only
        k = dict(lean=-self.SHARE * p + self.LEAN, turn=self.TURN, look_pitch=self.NOD - (1 - self.SHARE) * p * self.HEAD_SHARE,
                 collar={'clavicle_r': (0.0, self.RAISE)})
        trunk = lambda t: k
        cant = Quaternion((0, 0, 1), self.CANT[c.gun] * DEG)  # about the head's own forward
        # the body as build() will pose it (the hips' height changes nothing in the chest's frame)
        local = self.author._upper(Vector((0, 0, -0.02)), Quaternion(), 'low', lean=(3.0 + k['lean']) * DEG, turn=k['turn'] * DEG, roll=0.0,
                                   head_pitch=(2.0 + k['look_pitch']) * DEG)
        _, rot = self.skel.fk(local, Vector((0, 0.9, -0.02)))
        world = ypr(0.0, -p * DEG, 0.0) @ HALF_TURN  # the barrel straight ahead, pitched up by p
        gun_q = rot['spine_05'].inverted() @ world
        gun_at = self.POCKET + self.LIFT  # the butt in the pocket, the gun brought up and in to the face
        stow = self.stow(self.carry2)
        palm, hand = self.GRIP[c.gun]
        main = Spot(c.parts_grip_main + palm, hand)
        # (aiming up the trunk leans back and the arm comes up straight short of its place: the palm
        # takes hold that much further back along the fore-end)
        slide = Vector((0, 0, self.UP_SLIDE[c.gun] * max(0.0, p) / 45.0 + self.DOWN_SLIDE * max(0.0, -p) / 45.0))
        sup = Spot(c.parts_grip_support + self.SUPPORT[c.gun] + slide, c.hand['Left'], loose=True)
        hands = {'Right': Hand('Right', [('hold', 0.0, 0.0, 'gun', main)]), 'Left': Hand('Left', [('hold', 0.0, 0.0, 'gun', sup)])}
        # A body whose head cannot reach the eye's place from the pocket (`aim.toFace` in its table)
        # has the gun brought to the face instead: after each weld, the gun moves by what the eye
        # still misses (chest frame), and the hands and the weld are solved again.
        for _ in range(int(self._A.get('toFace', 0)) + 1):
            self.butt_at = gun_at.copy()
            frames, meta = self.build(0.0, trunk, lambda t: {'gun': (gun_at - c.shift, gun_q), 'gun2': stow},
                                      hands, lambda t: dict(self.POLE), lambda t: {'Left': 1.0, 'Right': 1.0})
            f = frames[0]
            # The cheek weld: the neck bends (forward and over towards the gun) until the aiming eye is at
            # its place behind the sight, while the head keeps the turn it has above (upright but for CANT,
            # chin a little down): the head is carried across onto the comb rather than tipped onto it.
            target = f['gun']['butt'] + f['gun']['quat'] @ (self.EYE[c.gun] + self.EYE_BACK + self.EYE_DOWN * max(0.0, -p) / 45.0)
            pos, rot = self.skel.fk(f['local'], f['hips'])
            head_w = rot['head'] @ cant
            for _ in range(8):
                pos, rot = self.skel.fk(f['local'], f['hips'])
                eye, neck = self.skel.sight_eye(pos, rot, 'Right'), pos['neck_01']
                turn = (eye - neck).rotation_difference(target - neck)
                neck_w = turn @ rot['neck_01']
                f['local']['neck_01'] = rot['spine_05'].inverted() @ neck_w
                f['local']['head'] = neck_w.inverted() @ head_w
            pos, rot = self.skel.fk(f['local'], f['hips'])
            miss = rot['spine_05'].inverted() @ (self.skel.sight_eye(pos, rot, 'Right') - target)
            gun_at = gun_at + miss
        pos, rot = self.skel.fk(f['local'], f['hips'])
        self.weld_cm = (self.skel.sight_eye(pos, rot, 'Right') - target).length * 100
        # how far the head is over, seen along the barrel: the line between the eyes against level
        pos, rot = self.skel.fk(f['local'], f['hips'])
        bore = (f['gun']['quat'] @ Vector((0, 0, -1))).normalized()
        across = self.skel.sight_eye(pos, rot, 'Left') - self.skel.sight_eye(pos, rot, 'Right')
        across -= bore * across.dot(bore)
        level = Vector((0, 1, 0)).cross(bore).normalized()
        self.cant_deg = math.degrees(math.asin(min(1.0, across.normalized().cross(level).length)))
        print(f'aim {c.gun} {p}: weld {self.weld_cm:.2f} cm, head over {self.cant_deg:.1f} deg, butt (chest frame) {tuple(round(x, 3) for x in self.butt_at)}')
        meta.update(loop=True, events={}, nodes=['PalmL', 'PalmR', 'ElbowL', 'ElbowR'], aim=round(p, 1))
        return frames, meta
