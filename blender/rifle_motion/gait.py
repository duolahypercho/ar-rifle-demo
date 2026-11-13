"""The clips as data: per frame, where the rig's controls go (all in glTF space, model frame).

A frame is {
  'hips':  Hips translation (G),
  'local': canonical local rotations (skel.py) of pelvis, spine_01, spine_03, spine_05, neck_01,
           head, the clavicles and fingers,
  'feet':  {side: (ground point under the ankle, heading, pitch)}, pitch + = toes up about the
           back of the heel, - = heel up about the ball (the rig's heel_pivot and ball_pivot),
  'gun':   the carry (carry.py) with its lag,
}

The walk is built the way a step works rather than copied from the capture. In an in-place
cycle the body stands still and the ground runs back under it at the walking speed, so a
planted foot is moved back at exactly that speed: it cannot skate. A foot in the air travels
over the ground on a minimum-jerk curve, starting and stopping at rest, so it leaves and lands
without a jolt. Heel and ball pivots give the roll: heel strike and toe-off going forward, ball
first and heel last going back, flatter steps sideways.

The jog and the sprint are runs built the same way (Author.cycle, a spec with `kick`): each foot
is on the ground for about a third of its cycle, so there is a flight between steps; a swinging
foot kicks up behind and goes over the ground at a nearly even speed (glide), and where the leg
could not reach it the foot is carried higher rather than the hips lowered; the hips are lowest
mid-stance and highest in the flight; the arms rock the gun with each step. The jogged side step
is a shuffle: the trailing foot lands soon after the leading one and then both are in the air.

Each gait clip is three cycles (six steps), no two alike: every step lands a little early or
late, a little further or nearer, a little in or out, and swings the pelvis, the shoulders and
the weight by a little more or less. The trunk is shaped by the gun (carry.TRUNK) and rides
quietly: the pelvis drops on the swinging side, shifts over the standing leg and turns with the
stride, the shoulders turn against it, the weight comes down on each footfall, the head stays
level, and the gun rides the chest a few hundredths of a second behind it. The hips ride a
little under the idle's height; they are lowered only where a standing leg would otherwise
straighten past the game's limit (character.js BENT_REACH).
"""
import math
import random

from mathutils import Quaternion, Vector

from . import body
from .carry import TRUNK
from .skel import ypr

FPS = 30
# the body's legs (rifle_motion/bodies/<body>.json `legs`)
_L = body.T['legs']
THIGH, SHIN = _L['thigh'], _L['shin']
ANKLE = Vector(_L['ankle'])  # ankle above its ground point, standing flat
HEEL = Vector(_L['heel'])  # back of the heel, from the ankle's ground point (rig.HEEL_PIVOT)
BALL = Vector(_L['ball'])  # the ball joint (ball_l at rest)
HIP = {k: Vector(v) for k, v in _L['hip'].items()}  # hip joint from the pelvis
ANKLE_Y, HIP_DROP = _L['ankleY'], _L['hipDrop']  # (as plain floats: the stand height below)
WIDTH_ADD = _L.get('widthAdd', 0.0)  # added to every gait's width (wider hips)
# Hip to ankle at most for a leg on the ground: the game's BENT_REACH (0.978 of the leg), so the
# game never has to lower the hips further than the clip does.
REACH = _L['reach'] * (THIGH + SHIN)
REACH_SWING = _L['reachSwing']
SPINE = ('spine_01', 'spine_03', 'spine_05')  # (spine_02 / spine_04 at rest: the exact mapping)
DEG = math.pi / 180
CYCLES = 3  # cycles in each walk clip (motion.js plays the clip's phase over that many)

# Game speeds: walking forward 1.45 m/s; sideways 60 % and straight back 75 % of it, on an ellipse
# between (player.js).
WALK_SPEED, SIDE_PACE, BACK_PACE = 1.45, 0.6, 0.75

# Per direction, going left (right mirrors it):
#   frames   the whole clip (CYCLES cycles) at 30 fps: the cadence. Forward 2.9 steps a second
#            of 0.50 m; straight sideways 5 a second, the feet opening from about hip width to
#            about half a metre; the diagonals in between; straight back 2.7 a second of 0.40 m.
#   beta     share of each foot's cycle spent on the ground
#   width    how far apart the feet run across (m, ankle centres)
#   land     share of each stance spent ahead of the hips
#   lift     how high the foot is lifted (m)
#   strike, push   foot pitch where it lands and leaves (degrees, + = toes up)
#   lean     forward lean of the trunk (degrees, chest against upright)
WALKS = {
    'f': dict(theta=0, frames=62, beta=0.58, width=0.18, land=0.38, lift=0.045, strike=14, push=-30, lean=5.0),
    'fl': dict(theta=45, frames=46, beta=0.58, width=0.30, land=0.45, lift=0.04, strike=6, push=-20, lean=4.0),
    'l': dict(theta=90, frames=36, beta=0.58, width=0.345, land=0.5, lift=0.035, strike=-3, push=-8, lean=3.0),
    'bl': dict(theta=135, frames=51, beta=0.6, width=0.30, land=0.5, lift=0.035, strike=-10, push=6, lean=1.5),
    'b': dict(theta=180, frames=66, beta=0.6, width=0.18, land=0.45, lift=0.035, strike=-16, push=12, lean=0.5),
}
# The jog (3.6 m/s forward, the same pace ellipse) and the sprint (5.2 m/s, forward only: a
# sprinting body faces the way it runs). Besides the walk's entries:
#   kick     how high a swinging foot is lifted behind (m, its ground point): a run's back-kick
#            rather than the walk's low swing
#   rise     share of the stance over which the heel comes up before the foot leaves
#   ramp     share of the swing over which the foot gets up to speed over the ground, and slows
#            again to land (see glide)
#   split    share of the cycle from the leading foot's landing to the trailing foot's (0.5 is an
#            even rhythm; a side shuffle lands the trailing foot soon after the leading one and
#            then both are in the air together, so the feet open and close by less than the
#            ground covered)
#   trail    the trailing foot's share of its cycle on the ground (beta is the leading foot's)
#   hips     the hips' design height against the walk's (m)
#   bob      how far the hips come down through each stance and rise in the flight (m)
#   pelvis, counter   the pelvis's turn with the stride and the chest's against it (degrees)
#   pump     how far the muzzle rocks with each step as the arms work the gun (degrees)
#   toe      how far each foot is turned out (degrees; the walk's 5)
#   impact   share of the footfall's sharp drop and nod (at six steps a second the full one would
#            jolt the gun's muzzle about)
#   hold     the carry (carry.HOLDS)
#   cross    `width` is measured across the way of travel, not across the body: on a diagonal
#            the legs then swing past each other side by side instead of each foot crossing
#            the body's middle (from the front, scissoring)
#   heading, into   how far the feet (and knees, whose poles ride on them) and the pelvis turn
#            into a diagonal (degrees; the walk's 10 and 6)
JOG_SPEED, SPRINT_SPEED = 3.6, 5.2
RUN = dict(rise=0.55, ramp=0.25, split=0.5, hips=-0.03, bob=0.03, pelvis=8.0, counter=6.0, pump=2.0, hold='low')
JOGS = {
    'f': dict(RUN, theta=0, frames=56, beta=0.32, width=0.15, land=0.34, lift=0.03, kick=0.2, strike=10, push=-42, lean=9.0),
    'fl': dict(RUN, theta=45, frames=48, beta=0.4, width=0.30, cross=True, heading=22, into=16, land=0.42, lift=0.03, kick=0.13,
               strike=4, push=-28, lean=7.0, pelvis=6.0, counter=5.0),
    'l': dict(RUN, theta=90, frames=30, beta=0.45, trail=0.34, split=0.25, width=0.40, ramp=0.35, land=0.5, lift=0.03, kick=0.0, strike=-4,
              push=-10, lean=7.0, hips=-0.075, bob=0.015, pelvis=0.0, counter=1.0, pump=0.6, impact=0.3, toe=12),
    'bl': dict(RUN, theta=135, frames=46, beta=0.44, width=0.25, cross=True, heading=18, into=12, land=0.53, lift=0.04, kick=0.06,
               strike=-12, push=8, lean=4.5, hips=-0.015, bob=0.02, pelvis=5.0, counter=4.0),
    'b': dict(RUN, theta=180, frames=46, beta=0.44, width=0.17, land=0.45, lift=0.04, kick=0.08, strike=-16, push=12, lean=4.0,
              hips=-0.015, bob=0.02, pelvis=6.0, counter=4.0),
}
SPRINT = dict(RUN, theta=0, frames=52, beta=0.28, width=0.13, land=0.38, lift=0.03, kick=0.3, strike=6, push=-50, lean=15.0,
              ramp=0.12, bob=0.035, pelvis=10.0, counter=6.0, pump=2.5, hold='sprint')
for _table in (WALKS, JOGS):
    for _key, _mirror in (('fl', 'fr'), ('l', 'r'), ('bl', 'br')):
        _table[_mirror] = dict(_table[_key], theta=-_table[_key]['theta'])
# How much each step may differ from the usual, either way (share, or m for `place`).
VARY = dict(time=0.04, reach=0.05, place=0.008, swing=0.2, drop=0.25, turn=0.2)


def speed_for(theta, pace=WALK_SPEED):
    """Ground speed the game gives this direction (player.js pace ellipse) at a forward `pace`."""
    mx, mz = -math.sin(theta), math.cos(theta)
    return pace / math.hypot(mx / SIDE_PACE, mz / (BACK_PACE if mz < 0 else 1))


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def min_jerk(x):
    x = min(1.0, max(0.0, x))
    return x * x * x * (10 - 15 * x + 6 * x * x)


def glide(x, a=0.25):
    """0 to 1 starting and ending at rest, but at a nearly even speed in between (the speed eases
    up over the first share `a` and down over the last): a running foot's swing over the ground.
    Min-jerk's peak speed would leave it standing still over the ground for long at either end,
    so in the body's frame it would be carried far back after leaving and far ahead before
    landing."""
    x = min(1.0, max(0.0, x))
    peak = 1 / (1 - a)
    ramp = lambda y: peak * a * (y ** 3 - y ** 4 / 2)  # the integral of ease over a ramp
    if x < a:
        return ramp(x / a)
    if x > 1 - a:
        return 1 - ramp((1 - x) / a)
    return ramp(1.0) + peak * (x - a)


def leg_span(bend_deg):
    """Hip to ankle for a knee bent this far."""
    return math.sqrt(THIGH ** 2 + SHIN ** 2 + 2 * THIGH * SHIN * math.cos(bend_deg * DEG))


def stand_height(bend_deg):
    """The pelvis height over feet flat on the ground with the knees bent this far."""
    return ANKLE_Y + leg_span(bend_deg) + HIP_DROP


def foot(ground, yaw, pitch):
    """Ankle position, foot and toe rotations (G) of a foot whose ground point, heading and pitch
    are given, rolled about the heel (pitch > 0) or the ball (pitch < 0) as the rig does."""
    turn = Quaternion((0, 1, 0), yaw)
    roll = Quaternion((1, 0, 0), -pitch)
    pivot = HEEL if pitch >= 0 else BALL
    ankle = ground + turn @ (pivot + roll @ (ANKLE - pivot))
    q = turn @ roll
    return ankle, q, (q if pitch >= 0 else turn)


def periodic_smooth(values, sigma, loop=True):
    """Gaussian smoothing; a clip that does not loop holds its first and last values beyond its ends."""
    n = len(values)
    r = int(math.ceil(sigma * 3))
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    total = sum(w)
    at = (lambda j: values[j % n]) if loop else (lambda j: values[min(n - 1, max(0, j))])
    return [sum(w[k + r] * at(i + k) for k in range(-r, r + 1)) / total for i in range(n)]


def jitter(rng, count, spread):
    """`count` values within +-spread with no overall bias, so a loop still adds up."""
    values = [rng.uniform(-spread, spread) for _ in range(count)]
    mean = sum(values) / count
    return [v - mean for v in values]


class Author:
    """Builds clips. `skel` is the Skeleton, `fingers` the finger grip (local rotations), `carry`
    the gun carry."""

    def __init__(self, skel, fingers, carry):
        self.skel, self.fingers, self.carry = skel, fingers, carry

    # ---------------------------------------------------------------- shared pieces

    def _upper(self, hips, hips_q, hold, lean, turn, roll, head_pitch=2 * DEG, breath=0.0):
        """The trunk round the gun (carry.TRUNK[hold]) on top of the pelvis: `lean` and `turn` are
        where the chest is meant to point in the model's frame (rad, + = forward / to the left),
        `roll` its roll against the pelvis's; the head is kept level, looking ahead. Returns local
        rotations."""
        shape = TRUNK[hold]
        local = {'pelvis': hips_q}
        # what the pelvis already leans and turns is taken back out up the spine
        fwd = hips_q @ Vector((0, 0, 1))
        hips_yaw = math.atan2(fwd.x, fwd.z)
        hips_pitch = math.asin(max(-1.0, min(1.0, -fwd.y)))
        yaw = turn + shape['turn'] * DEG - hips_yaw
        pitch = lean - sum(shape['lean']) * DEG - hips_pitch
        share = (0.3, 0.35, 0.35)
        for name, k, base in zip(SPINE, share, shape['lean']):
            local[name] = ypr(yaw * k, base * DEG + pitch * k, roll * k)
        for side, sign in (('clavicle_l', 1), ('clavicle_r', -1)):
            local[side] = ypr(shape['collar'][side] * DEG, 0, sign * breath)
        _, rot = self.skel.fk(local, hips)
        want = ypr(0.0, head_pitch, 0.0)  # head level in the world, looking straight ahead
        bend = rot['spine_05'].inverted() @ want
        local['neck_01'] = Quaternion().slerp(bend, 0.5)
        local['head'] = local['neck_01'].inverted() @ bend
        local.update(self.fingers)
        return local

    def _hips_height(self, frames, design, lift_swing=False, loop=True):
        """Lowers the hips wherever a leg could not reach its foot with the knee bent, smoothly.
        With `lift_swing` (a run) only the feet on the ground decide: a swinging foot that the
        leg could not reach is carried higher instead, as a running leg folds under the body
        rather than the body sinking to meet it."""
        n = len(frames)
        allowed = []

        def gap(f, side):
            """(how far the ankle is from its hip across, the leg's reach for it)"""
            ground, yaw, pitch = f['feet'][side]
            ankle = foot(ground, yaw, pitch)[0]
            hip = f['local']['pelvis'] @ HIP[side]
            r = REACH if ground.y < 1e-6 or lift_swing else REACH_SWING
            across = math.hypot(f['hips'].x + hip.x - ankle.x, f['hips'].z + hip.z - ankle.z)
            if across >= r:
                raise ValueError(f'the {side} foot is {across:.3f} m out from its hip at frame {frames.index(f)}: out of reach')
            return ankle, hip, math.sqrt(r * r - across * across)

        def landing(i, side):
            """Frames until this foot is next on the ground."""
            if not loop:
                return next((k for k in range(n - i) if frames[i + k]['feet'][side][0].y <= 1e-6), n)
            return next(k for k in range(n) if frames[(i + k) % n]['feet'][side][0].y <= 1e-6)

        for i, f in enumerate(frames):
            best = math.inf
            for side, (ground, yaw, pitch) in f['feet'].items():
                # (a foot about to land does: the body comes down to meet the ground)
                if lift_swing and ground.y > 1e-6 and landing(i, side) > 3:
                    continue
                ankle, hip, up = gap(f, side)
                best = min(best, ankle.y + up - hip.y)
            allowed.append(best)
        short = [max(0.0, design[i] - allowed[i]) for i in range(n)]
        near = (lambda j: short[j % n]) if loop else (lambda j: short[min(n - 1, max(0, j))])
        wide = [max(near(i + k) for k in range(-2, 3)) for i in range(n)]
        lower = periodic_smooth(wide, 1.5, loop)
        for i, f in enumerate(frames):
            f['hips'].y = min(design[i] - lower[i], allowed[i])
        if lift_swing:
            for side in ('Left', 'Right'):
                swinging = [f['feet'][side][0].y > 1e-6 for f in frames]
                rise = []
                for f, up in zip(frames, swinging):
                    if not up:
                        rise.append(0.0)
                        continue
                    ankle, hip, reach = gap(f, side)
                    rise.append(max(0.0, f['hips'].y + hip.y - reach - ankle.y))
                # (eased out over the last frames before the foot lands, so it comes down onto
                # the ground rather than dropping onto it)
                smooth = periodic_smooth(rise, 1.0, loop)
                for i, f in enumerate(frames):
                    if swinging[i]:
                        f['feet'][side][0].y += smooth[i] * ease(landing(i, side) / 4)
        return lower

    def _gun(self, frames, hold='low', offsets=None, loop=True, lag=1.0):
        """The gun on its hold, trailing the chest a little: it is set back by its own velocity
        and turned back by its own spin over a few hundredths of a second."""
        n = len(frames)
        chest = [self.skel.fk(f['local'], f['hips']) for f in frames]
        offset = offsets or [None] * n
        placed = [self.carry.place(pos['spine_05'], rot['spine_05'], hold, offset=offset[i]) for i, (pos, rot) in enumerate(chest)]
        lag_pos, lag_rot = 0.035 * lag, 0.05 * lag  # s (`lag`: a share of it, crouch.py's quick drop)
        for i, f in enumerate(frames):
            # (a clip that does not loop is differenced one-sided at its ends)
            i0, i1 = ((i - 1) % n, (i + 1) % n) if loop else (max(0, i - 1), min(n - 1, i + 1))
            a, b = placed[i0], placed[i1]
            span = (i1 - i0) % n if loop else i1 - i0
            rate = FPS / max(1, span)
            vel = (b['butt'] - a['butt']) * rate
            spin = b['quat'] @ a['quat'].inverted()
            if spin.w < 0:
                spin.negate()
            axis, angle = spin.to_axis_angle()
            back = Quaternion(axis, -angle * rate * lag_rot)
            pos, rot = chest[i]
            f['gun'] = self.carry.place(pos['spine_05'], rot['spine_05'], hold, lag=(-vel * lag_pos, back), offset=offset[i])
        return frames

    # ---------------------------------------------------------------- the walk

    def walk(self, key):
        return self.cycle(WALKS[key], 'walk-' + key, WALK_SPEED)

    def jog(self, key):
        return self.cycle(JOGS[key], 'jog-' + key, JOG_SPEED)

    def sprint(self):
        return self.cycle(SPRINT, 'sprint', SPRINT_SPEED)

    def cycle(self, spec, seed, pace):
        """One looping gait clip of CYCLES cycles in the direction spec['theta'] at the game's speed
        for it; a spec with `kick` is a run (flight, back-kick, the hips lowest mid-stance)."""
        theta = spec['theta'] * DEG
        n, beta = spec['frames'], spec['beta']
        run = 'kick' in spec
        steps = 2 * CYCLES
        v = speed_for(theta, pace)
        rng = random.Random(seed)
        cycle = n / CYCLES  # frames
        stride = v * cycle / FPS  # ground each foot covers in one cycle
        u = Vector((math.sin(theta), 0, math.cos(theta)))  # the way of travel (+X is left)
        c, s = math.cos(theta), math.sin(theta)
        diag = math.sin(2 * theta)
        # the leading foot (the left going left) and the trailing one's shares of the cycle on
        # the ground, and the share of the cycle from the left foot's landing to the right one's
        lead_left = theta >= 0
        betas = {'Left': beta if lead_left else spec.get('trail', beta), 'Right': spec.get('trail', beta) if lead_left else beta}
        split = spec.get('split', 0.5)
        split = split if lead_left else 1 - split
        toe_out = spec.get('toe', 5) * DEG
        # feet (and with them the knees) and pelvis turn a little into a diagonal (toes leading
        # forward, heels back)
        heading = spec.get('heading', 10) * DEG * diag
        into = spec.get('into', 6) * DEG * diag
        strike, push = spec['strike'] * DEG, spec['push'] * DEG

        # the six steps: when each lands, how far ahead and how far out, how hard the body swings
        times = [cycle * (split if k % 2 == 0 else 1 - split) * (1 + e) for k, e in enumerate(jitter(rng, steps, VARY['time']))]
        land = [sum(times[:k]) for k in range(steps)]
        ahead = [spec['land'] * stride * betas['Left' if k % 2 == 0 else 'Right'] for k in range(steps)]  # where a foot lands, ahead of its centre along u
        reach = [ahead[k] * (1 + e) for k, e in enumerate(jitter(rng, steps, VARY['reach']))]
        place = jitter(rng, steps, VARY['place'])
        amp = {k: [1 + e for e in jitter(rng, steps, VARY[k])] for k in ('swing', 'drop', 'turn')}

        def stance_of(k):
            """Step k's foot on the ground: lands at land[k], leaves its share of its own cycle later."""
            return land[k], land[k] + betas['Left' if k % 2 == 0 else 'Right'] * (land[(k + 2) % steps] + (n if k + 2 >= steps else 0) - land[k])

        def rise_of(k):
            """Frames the heel (or toes) take to come up before the foot leaves."""
            if run:
                t0, t1 = stance_of(k)
                return spec['rise'] * (t1 - t0)
            return (0.22 if abs(c) > 0.5 else 0.16) * cycle

        def foot_at(side, t):
            """(along, across offset, lift, pitch) of one foot at frame t."""
            first = 0 if side == 'Left' else 1
            for k in range(first, steps, 2):
                t0, t1 = stance_of(k)
                rise = rise_of(k)
                dt = (t - t0) % n
                if dt < t1 - t0:  # on the ground, carried back at the ground speed
                    along = reach[k] - v * dt / FPS
                    pitch = strike * (1 - ease(dt / (0.1 * cycle)))
                    if dt > t1 - t0 - rise:
                        pitch += push * ease((dt - (t1 - t0 - rise)) / rise) ** 1.6
                    return along, place[k], 0.0, pitch
                k2 = (k + 2) % steps
                gap = (land[k2] - t1) % n  # the swing, from leaving to landing again
                if dt - (t1 - t0) < gap:
                    sig = (dt - (t1 - t0)) / gap
                    lift_at = reach[k] - v * (t1 - t0) / FPS
                    covered = reach[k2] - lift_at + v * gap / FPS  # over the ground
                    # (walking, the foot comes up before it goes and is set down after it stops: no
                    # scuff; running, it is off the ground at once and reaches as long as it can)
                    along = lift_at + covered * (glide(sig, spec['ramp']) if run else min_jerk((sig - 0.05) / 0.85)) - v * (dt - (t1 - t0)) / FPS
                    across = place[k] + (place[k2] - place[k]) * min_jerk(sig)
                    if run:
                        # (kept clear of the ground until near the end, where a running foot is
                        # still travelling fast, but rising and settling at a finite speed)
                        lift = spec['lift'] * (1 - (1 - math.sin(math.pi * sig)) ** 2)
                        # the heel kicked up behind early in the swing, then the foot reaching
                        # forward low to land
                        lift += spec['kick'] * (math.sin(0.5 * math.pi * sig / 0.35) if sig < 0.35 else 1 - ease((sig - 0.35) / 0.6))
                    else:
                        lift = spec['lift'] * (ease(sig / 0.22) if sig < 0.22 else 1 - ((sig - 0.22) / 0.78) ** 2.2)
                    pitch = push * (1 - ease(sig / 0.55)) + strike * ease((sig - 0.35) / 0.65)
                    return along, across, lift, pitch
            raise AssertionError('every moment is a stance or a swing')

        # the steps' own timing, as a smooth count of steps (0 as the left foot lands)
        raw = []
        for i in range(n):
            k = max(j for j in range(steps) if land[j] <= i)
            nxt = land[k + 1] if k + 1 < steps else n
            raw.append(k + (i - land[k]) / (nxt - land[k]) - i * steps / n)
        count = [r + i * steps / n for i, r in enumerate(periodic_smooth(raw, 2.0))]

        def each(values, x):
            """A per-step value at step count x, eased from one step to the next."""
            k = int(math.floor(x))
            a, b = values[k % steps], values[(k + 1) % steps]
            return a + (b - a) * ease(x - k)

        hold = spec.get('hold', 'low')
        pelvis, counter = spec.get('pelvis', 6.0) * DEG, spec.get('counter', 2.5) * DEG
        frames, design, offsets = [], [], []
        hip_mid = stand_height(26)  # the idle's height: the trunk rides on slightly bent knees
        for i in range(n):
            x = count[i]
            p = x / 2  # cycles
            feet = {}
            for side in ('Left', 'Right'):
                along, out, lift, pitch = foot_at(side, i)
                half = ((spec['width'] + WIDTH_ADD) / 2 + out) * (1 if side == 'Left' else -1)
                # (`cross`: the feet run on lines that far apart across the way of travel rather
                # than across the body, so a diagonal's legs swing past each other side by side;
                # the left foot on the body's left of them, backing away too)
                centre = Vector((abs(c), 0, -s * math.copysign(1, c))) * half if spec.get('cross') else Vector((half, 0, 0))
                ground = centre + u * along
                ground.y = lift
                feet[side] = (ground, heading + (toe_out if side == 'Left' else -toe_out), pitch)
            swing, drop, turn_amp = each(amp['swing'], x), each(amp['drop'], x), each(amp['turn'], x)
            # pelvis: turns with the stride, drops on the swinging side and shifts over the standing
            # leg, tips forward a little (further at a run: the lean starts at the ankles)
            yaw = into - pelvis * c * math.cos(2 * math.pi * p) * turn_amp
            roll = (4.0 * c * c + 3.0 * s * s) * DEG * math.sin(2 * math.pi * (p - 0.05)) * swing * (0.6 if run else 1.0)
            hips_q = ypr(yaw, (2 + 1.5 * c + (3.0 * c * c if run else 0.0) + spec.get('tilt', 0.0)) * DEG, roll)
            sway = (0.02 * c * c + 0.026 * s * s) * math.sin(2 * math.pi * (p - 0.03)) * swing * (0.5 if run else 1.0)
            surge = 0.006 * c * math.sin(4 * math.pi * (p - 0.1))
            # each footfall: the weight comes down sharply and the hips rise again slowly; at a run
            # the hips are lowest mid-stance (a share beta of the cycle is two of a step's) and
            # highest in the flight
            q = x % 1.0
            hit = (q / 0.14) * math.exp(1 - q / 0.14) * spec.get('impact', 1.0)
            if run:
                bob = spec['hips'] - 0.5 * spec['bob'] * math.cos(2 * math.pi * (q - beta)) - 0.006 * hit * drop
            else:
                bob = (-0.006 * (0.5 + 0.5 * math.cos(4 * math.pi * (p - 0.09))) - 0.012 * hit * drop) * spec.get('bounce', 1.0)
            # (`drop`: a crouched gait rides that much lower; crouch.py)
            design.append(hip_mid - 0.008 + bob - spec.get('drop', 0.0))
            hips = Vector((sway, 0.0, surge))
            # the shoulders turn against the hips and the chest stays near square to the view; the
            # trunk leans in a little going forward and comes upright backing away; a nod after
            # each footfall
            chest_turn = counter * c * math.cos(2 * math.pi * p) * turn_amp
            nod = (1.2 if run else 0.6) * DEG * hit * drop
            local = self._upper(hips, hips_q, hold, lean=spec['lean'] * DEG + nod, turn=chest_turn, roll=-1.1 * roll,
                                head_pitch=(2 + 0.6 * math.cos(4 * math.pi * p - 0.6)) * DEG)
            frames.append({'hips': hips, 'local': local, 'feet': feet})
            # running, the arms work the gun against the stride: it turns a little further than
            # the chest with each stride and the muzzle rocks down and up with each footfall
            pump = spec.get('pump', 0.0) * drop
            if run:
                offsets.append((0.6 * math.degrees(chest_turn), pump * math.cos(2 * math.pi * x - 1.0), 0.0,
                                Vector((0, -0.006 * pump * math.cos(2 * math.pi * x - 1.0), 0))))
            else:
                # (`gun`: a crouched gait carries the muzzle up against its lean, crouch.py)
                offsets.append(spec['gun'] if 'gun' in spec else None)
        self._hips_height(frames, design, lift_swing=run)
        self._gun(frames, hold=hold, offsets=offsets if run or 'gun' in spec else None)
        windows = {side: [] for side in ('Left', 'Right')}
        for k in range(steps):
            t0, t1 = stance_of(k)
            windows['Left' if k % 2 == 0 else 'Right'].append([round(t0 / n, 4), round((t1 / n) % 1.0, 4)])
        meta = dict(duration=n / FPS, loop=True, frames=n, cycles=CYCLES, speed=round(v, 4), direction=round(theta, 5),
                    dir=[round(u.x, 5), round(u.z, 5)], stride=round(stride, 4), cadence=round(steps / (n / FPS), 3),
                    contact=windows, leftStrike=0.0, beta=beta)
        return frames, meta

    # ---------------------------------------------------------------- standing

    def idle(self, stance, seconds=8.0):
        """A ready stance that never quite holds still: the weight goes onto one leg and back over
        the clip, the chest breathes (three breaths), the head looks about a little, and the gun
        settles in the hands: the muzzle sinks with the breath out and drifts across and back."""
        n = int(round(seconds * FPS))
        hip_mid = stand_height(17)
        frames, design, offsets = [], [], []
        for i in range(n):
            t = i / FPS
            w = math.sin(2 * math.pi * t / seconds)  # weight: + onto the left (lead) leg
            breath = math.sin(2 * math.pi * 3 * t / seconds)  # + breathing in
            yaw = -0.10 + 0.015 * math.sin(2 * math.pi * t / seconds + 2)
            roll = 0.035 * w
            hips_q = ypr(yaw, 0.04, roll)
            hips = Vector((0.018 * w, 0.0, 0.005 * math.sin(2 * math.pi * t / seconds + 1) - 0.02))
            design.append(hip_mid + 0.002 * breath - 0.004 * abs(w))
            look = 0.05 * math.sin(2 * math.pi * t / seconds + 0.5) + 0.02 * math.sin(2 * math.pi * 3 * t / seconds)
            local = self._upper(hips, hips_q, 'low', lean=(3.0 - 0.6 * breath) * DEG,
                                turn=0.012 * math.sin(2 * math.pi * t / seconds + 0.7) + 0.2 * roll, roll=-0.8 * roll,
                                head_pitch=0.035 + 0.012 * math.sin(2 * math.pi * 2 * t / seconds + 1), breath=0.012 * (breath + 1))
            # the head looks about on top of being kept level
            local['head'] = local['head'] @ Quaternion((0, 1, 0), look)
            feet = {side: (stance[side][0].copy(), stance[side][1], 0.0) for side in ('Left', 'Right')}
            frames.append({'hips': hips, 'local': local, 'feet': feet})
            # the gun: dips a degree as the breath goes out, wanders a little across and back, and
            # the arms let it sink a touch while the weight is on the back leg
            offsets.append((1.5 * math.sin(2 * math.pi * 2 * t / seconds + 2.2) - 0.6 * w,
                            -1.0 * breath + 1.2 * math.sin(2 * math.pi * t / seconds + 0.4),
                            0.8 * math.sin(2 * math.pi * 3 * t / seconds + 1.1),
                            Vector((0, -0.004 * (1 - w), 0.003 * breath))))
        self._hips_height(frames, design)
        self._gun(frames, offsets=offsets)
        meta = dict(duration=n / FPS, loop=True, frames=n, cycles=1, speed=0.0, direction=0.0, dir=[0, 0],
                    contact={'Left': [[0.0, 1.0]], 'Right': [[0.0, 1.0]]}, leftStrike=None,
                    stance={side: dict(x=round(stance[side][0].x, 4), z=round(stance[side][0].z, 4), yaw=round(stance[side][1], 4))
                            for side in ('Left', 'Right')})
        return frames, meta

    def hold(self, kind, stance):
        """One still frame of a hold ('low' or 'high') over the standing feet, the pelvis square:
        the game builds its running upper body from these, and the high ready as the difference
        between them, so they carry no lean or turn of the pelvis."""
        hips = Vector((0.0, 0.0, -0.02))
        local = self._upper(hips, Quaternion(), kind, lean=(3.0 if kind == 'low' else 2.0) * DEG, turn=0.0, roll=0.0)
        frames = [{'hips': hips, 'local': local, 'feet': {side: (stance[side][0].copy(), stance[side][1], 0.0) for side in ('Left', 'Right')}}]
        self._hips_height(frames, [stand_height(17)])
        self._gun(frames, hold=kind)
        # (a one-frame loop: exported as two equal keys a frame apart)
        meta = dict(duration=1 / FPS, loop=True, frames=1, cycles=1, speed=0.0, direction=0.0, dir=[0, 0],
                    contact={'Left': [[0.0, 1.0]], 'Right': [[0.0, 1.0]]}, leftStrike=None)
        return frames, meta
