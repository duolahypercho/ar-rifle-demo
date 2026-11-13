"""The tactical crouch: a ready crouch that never holds still, the crouched walk in eight directions,
and going down into it and coming back up (pass 9).

The crouch is a trained shooter's: feet staggered (the rear one stepped back and out), the weight
low and forward over the front foot, the rear heel up on the ball, both knees bent deep (about 100
to 115 degrees) but not sat on the heels, the pelvis tipped forward and the trunk leaning in over
it, head up and level, the gun at the low ready with its muzzle carried up against the lean (so it
points ahead and down past the front knee, not into it).

  crouch_idle    9 s: the weight rocks between the feet and fore and aft, re-settles twice (a
                 small sink and recovery with a shift), breathes, and the head scans about further
                 than the standing idle's. Every pose is `_pose(k=1, t)`.
  crouch walk    gait.Author.cycle with the crouch's spec entries (`drop`, `tilt`, `bounce`, `gun`):
                 1.0 m/s forward in short quick steps (0.38 m at 2.6 a second), flat-footed
                 landings with a little roll, the pelvis low and level.
  down / up      0.43 s: `_pose(k, 0)` with k on a curve: going down the hips lead, the trunk and
                 the rear foot (stepped back) follow, and a small settle at the bottom; coming up
                 the legs push (a dip of a centimetre first), the trunk comes upright after the
                 hips, the rear foot steps back in, and the body rises a touch past standing before
                 settling. Each starts and ends on the pose its neighbour starts on: rifle-idle's
                 first frame and rifle-crouch-idle's.
"""
import math

from mathutils import Quaternion, Vector

from . import body
from .gait import DEG, FPS, WALKS, ease, leg_span, min_jerk, stand_height

# the standing stance (build_rifle_motion.STANCE) and the crouched one: the rear foot stepped
# 12 cm back and 2 cm out, up on its ball (pitch: - = heel up about the ball)
# (the front foot stays where it stood; per body: bodies/<body>.json `crouch`)
CROUCH_STANCE = {k: (Vector(v[0]), v[1], v[2] * DEG if v[2] else 0.0) for k, v in body.T['crouch']['stance'].items()}
CROUCH_SPEED = 1.0  # m/s forward; sideways and back at the game's pace ellipse (gait.speed_for)
IDLE_SECONDS = 9.0
CHANGE_FRAMES = 14  # 0.43 s at 30 fps, both ends included

# the crouched walk, going left (right mirrors): as gait.WALKS, plus
#   drop    how far the hips ride under the walk's design height (m)
#   tilt    extra forward tip of the pelvis (degrees)
#   bounce  share of the walk's footfall drop and bob (a crouched walk glides)
#   gun     (yaw, pitch, roll degrees, butt shift) on the low hold: the muzzle carried up against
#           the lean
_C = dict(drop=body.T['crouch']['drop'], tilt=10.0, bounce=0.45, lean=20.0, gun=(0.0, -14.0, 0.0, Vector((0, 0.0, 0.01))))
CROUCH_WALKS = {
    'f': dict(WALKS['f'], **_C, frames=69, width=0.22, land=0.42, lift=0.04, strike=8, push=-22),
    'fl': dict(WALKS['fl'], **_C, frames=56, width=0.32, land=0.46, lift=0.035, strike=4, push=-16),
    'l': dict(WALKS['l'], **_C, frames=45, width=0.36, land=0.5, lift=0.03, strike=-2, push=-6),
    'bl': dict(WALKS['bl'], **_C, frames=60, width=0.32, land=0.5, lift=0.03, strike=-6, push=4),
    'b': dict(WALKS['b'], **_C, frames=75, width=0.22, land=0.45, lift=0.03, strike=-10, push=8),
}
for _key, _mirror in (('fl', 'fr'), ('l', 'r'), ('bl', 'br')):
    CROUCH_WALKS[_mirror] = dict(CROUCH_WALKS[_key], theta=-CROUCH_WALKS[_key]['theta'])
for _key, _spec in CROUCH_WALKS.items():
    _spec['lean'] = {'f': 23.0, 'fl': 22.0, 'l': 21.0, 'bl': 19.0, 'b': 18.0, 'fr': 22.0, 'r': 21.0, 'br': 19.0}[_key]


def crouch_walk(author, key):
    frames, meta = author.cycle(CROUCH_WALKS[key], 'crouch-walk-' + key, CROUCH_SPEED)
    meta['crouch'] = 1
    return frames, meta


def _life(t, seconds=IDLE_SECONDS):
    """The crouch idle's slow changes at t s: weight across (+ onto the left, front foot) and fore
    and aft (+ forward), breath, and the two re-settles (0..1 pulses)."""
    w = 2 * math.pi * t / seconds
    across = 0.8 * math.sin(w) + 0.2 * math.sin(3 * w + 1.0)
    fore = 0.6 * math.sin(2 * w + 0.4) + 0.3 * math.sin(w + 2.0)
    breath = math.sin(2 * math.pi * 4 * t / seconds)  # four breaths in the clip: not in step with the sway

    def pulse(at, width=0.45):
        d = ((t - at + seconds / 2) % seconds) - seconds / 2
        return math.exp(-0.5 * (d / width) ** 2)

    settle = pulse(3.1) - 0.8 * pulse(6.7, 0.55)
    return across, fore, breath, settle


def make_pose(author, k, t, stance, rear=None, trunk=None, lift=0.0):
    rear = k if rear is None else rear
    trunk = k if trunk is None else trunk
    across, fore, breath, settle = _life(t) if k > 0 else (0.0, 0.0, 0.0, 0.0)
    # standing terms: rifle-idle at t = 0 (gait.Author.idle)
    s_w = 0.0
    s_breath = 0.0
    s_yaw = -0.10 + 0.015 * math.sin(2)
    s_hips = Vector((0.018 * s_w, 0.0, 0.005 * math.sin(1) - 0.02))
    s_height = stand_height(17) + 0.002 * s_breath
    s_look = 0.05 * math.sin(0.5)
    # crouched terms
    c_height = 0.56 - 0.006 * breath - 0.012 * settle - 0.006 * abs(across) + 0.008 * fore
    c_hips = Vector((0.03 * across + 0.008 * settle, 0.0, 0.0 + 0.03 * fore - 0.01 * settle))
    c_yaw = -0.16 + 0.03 * across + 0.02 * math.sin(2 * math.pi * t / 4.5)
    c_look = 0.18 * math.sin(2 * math.pi * t / IDLE_SECONDS + 0.5) + 0.07 * math.sin(2 * math.pi * t / 2.25 + 1.0)
    lerp = lambda a, b, x: a + (b - a) * x
    height = lerp(s_height, c_height, k) + lift
    hips = s_hips.lerp(c_hips, k)
    yaw = lerp(s_yaw, c_yaw, k)
    roll = lerp(0.0, 0.03 * across + 0.012 * settle, k)
    hips_q = Quaternion((0, 1, 0), yaw) @ Quaternion((1, 0, 0), lerp(0.04, 0.04 + 12 * DEG + 0.02 * fore, trunk)) @ Quaternion((0, 0, 1), roll)
    lean = lerp(3.0 * DEG, (24.0 + 1.5 * fore - 0.5 * breath) * DEG, trunk)
    local = author._upper(hips, hips_q, 'low', lean=lean, turn=lerp(0.012 * math.sin(0.7), 0.03 * across, k),
                          roll=-0.8 * roll, head_pitch=lerp(0.035 + 0.012 * math.sin(1), 0.02 + 0.03 * math.sin(2 * math.pi * t / 4.5 + 0.7), k),
                          breath=0.012 * (lerp(s_breath, breath, k) + 1))
    local['head'] = local['head'] @ Quaternion((0, 1, 0), lerp(s_look, c_look, k))
    feet = {}
    for side in ('Left', 'Right'):
        (g0, y0), (g1, y1, p1) = stance[side], CROUCH_STANCE[side]
        x = rear if side == 'Right' else min(1.0, k)
        ground = g0.lerp(g1, x)
        if side == 'Right':
            # the rear foot is picked up and put down, not slid: off the ground over the middle of its move
            ground.y = 0.045 * math.sin(math.pi * min(1.0, max(0.0, x))) ** 2 if 0.0 < x < 1.0 else 0.0
        feet[side] = (ground, lerp(y0, y1, x), lerp(0.0, p1 + (2 * DEG * across if side == 'Right' else 0.0), x))
    # the gun: carried up against the lean, breathing, drifting a little with the weight
    gun = (lerp(0.0, 1.2 * math.sin(2 * math.pi * t / 4.5 + 1.0) - 0.8 * across, k),
           lerp(1.2 * math.sin(0.4), -14.0 - 1.0 * breath + 1.0 * fore, max(trunk, min(1.0, k))),
           lerp(0.0, 0.6 * math.sin(2 * math.pi * t / 3.0), k),
           Vector((0, -0.004 + 0.002 * breath * k, 0.01 * trunk)))
    return {'hips': hips, 'local': local, 'feet': feet}, height, gun


def _finish(author, frames, design, offsets, loop, lag=1.0):
    author._hips_height(frames, design, loop=loop)
    author._gun(frames, offsets=offsets, loop=loop, lag=lag)


def crouch_idle(author, stance):
    n = int(round(IDLE_SECONDS * FPS))
    frames, design, offsets = [], [], []
    for i in range(n):
        f, h, g = make_pose(author, 1.0, i / FPS, stance)
        frames.append(f)
        design.append(h)
        offsets.append(g)
    _finish(author, frames, design, offsets, True)
    meta = dict(duration=n / FPS, loop=True, frames=n, cycles=1, speed=0.0, direction=0.0, dir=[0, 0],
                contact={'Left': [[0.0, 1.0]], 'Right': [[0.0, 1.0]]}, leftStrike=None, crouch=1,
                stance={side: dict(x=round(CROUCH_STANCE[side][0].x, 4), z=round(CROUCH_STANCE[side][0].z, 4),
                                   yaw=round(CROUCH_STANCE[side][1], 4), pitch=round(CROUCH_STANCE[side][2], 4)) for side in ('Left', 'Right')})
    return frames, meta


def crouch_change(author, stance, down):
    """Standing into the crouch (down) or back (up), CHANGE_FRAMES frames."""
    n = CHANGE_FRAMES
    frames, design, offsets = [], [], []
    for i in range(n):
        u = i / (n - 1)
        if down:
            # the hips lead down and sink 1.5 cm past the crouch before settling into it
            k = min_jerk(u / 0.78) + 0.05 * math.sin(math.pi * min(1.0, max(0.0, (u - 0.55) / 0.45))) ** 2 * (1 if u < 0.999 else 0)
            trunk = min_jerk((u - 0.08) / 0.8)
            rear = min_jerk((u - 0.05) / 0.6)
            lift = 0.0
        else:
            # a centimetre's dip, then the legs drive up; the trunk follows; a touch past standing
            k = 1 - min_jerk((u - 0.1) / 0.72)
            trunk = 1 - min_jerk((u - 0.22) / 0.7)
            rear = 1 - min_jerk((u - 0.3) / 0.6)
            lift = -0.01 * math.sin(math.pi * min(1.0, u / 0.2)) * (u < 0.2) + 0.008 * math.sin(math.pi * min(1.0, max(0.0, (u - 0.6) / 0.4)))
        f, h, g = make_pose(author, k, 0.0, stance, rear=rear, trunk=trunk, lift=lift)
        frames.append(f)
        design.append(h)
        offsets.append(g)
    # (the gun trails the chest by less than the gait's lag: dropping 33 cm in 0.3 s, the full lag
    # would lift it 5 cm towards the shoulder and fold the firing wrist past 40 degrees)
    _finish(author, frames, design, offsets, False, lag=0.25)
    down_feet = [[1.0, 1.0 if not (0.02 < f['feet']['Right'][0].y) else 0.0] for f in frames]
    meta = dict(duration=(n - 1) / FPS, loop=False, frames=n, cycles=1, speed=0.0, direction=0.0, dir=[0, 0],
                contact={'Left': [[0.0, 1.0]], 'Right': [[0.0, 1.0]]}, leftStrike=None, kind='crouch-' + ('down' if down else 'up'),
                feetDown=down_feet)
    return frames, meta
