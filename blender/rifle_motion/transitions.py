"""Locomotion transitions: one-shot clips that move the body over the ground (root motion).

  rifle-pivot-l45 / -l90 / -l135 / -l180, -r45 ... -r180   turning on the spot
  rifle-walk-start, rifle-jog-start                          setting off forward
  rifle-walk-stop-0 ... -7, rifle-jog-stop-0 ... -7          stopping, from each eighth of the loop's cycle
  rifle-run-turn-l / -r                                      a running about-turn (plant and turn)

Each is planned in the world: footfalls (where and when each foot is put down, how it rolls and
swivels while down, how it travels in the air), a path for the root (the point on the ground the
game moves, and its heading), and the body over them (hips height and turn, lean, where the chest
and head look). A planted foot stays exactly where it was put down in the world, so it cannot
skate whatever the root does. Every frame is then expressed in the root's frame, which is what
the game plays: it moves and turns the character by the root track (notes `root`, per frame
[x, z, yaw] from the clip's start: +x left, +z forward, + yaw to the left) and the clip's feet
land where they were planned.

The weight goes onto the foot that bears it: the hips are drawn towards whichever feet are down,
smoothed so that they move across before a foot lifts, not as it lifts. The hips' height is
designed and then lowered wherever a standing leg could not reach its foot with the knee still
bent, as in the loops (gait.Author._hips_height).

Clips that come from or go into a loop (stops and the about-turn come from one; starts and the
about-turn go into one) begin or end on a footfall of that loop at its own speed, with the feet
where the loop has them: `entry` / `exit` in the notes say which loop, which foot lands, the loop's
phase there (cycles, as the game counts it) and the speed.
"""
import math

from mathutils import Quaternion, Vector

from .gait import BALL, CYCLES, FPS, JOGS, JOG_SPEED, RUN, WALKS, WALK_SPEED, ease, glide, leg_span, min_jerk, stand_height, WIDTH_ADD

INF = math.inf
SIDES = ('Left', 'Right')
BALL_FLAT = Vector((BALL.x, 0, BALL.z))
IDLE_HIPS = stand_height(17)  # the idle's design height (gait.Author.idle)
LOOP_RAMP = RUN['ramp']  # the loops' running swing (see stance)
# Where the jog has the other foot as one lands (measured in the game: behind the root and kicked
# up, m), so a clip that begins on a jog's footfall picks it up there, already in the air.
KICKED = (-0.27, 0.2)
START_LIFT = -1e-3
WALK_HIPS = stand_height(26) - 0.008  # the walk's and the runs' (gait.Author.cycle)


def turn(yaw):
    return Quaternion((0, 1, 0), yaw)


def flat(v):
    return Vector((v.x, 0.0, v.z))


def bump(x, a, b):
    """0 outside a..b, rising to 1 in the middle and back, smoothly."""
    if x <= a or x >= b:
        return 0.0
    return math.sin(math.pi * (x - a) / (b - a)) ** 2


def mj(x, a=0.0, b=1.0):
    """min-jerk from 0 at a to 1 at b"""
    return min_jerk((x - a) / (b - a))


def stance(land, lift, at, yaw, strike=0.0, push=0.0, rise=0.08, swivel=None, arc=None, wide=0.0, body=False, run=False, ramp=0.4, height=0.05, kick=0.0,
           air=0.0, vel=None):
    """One footfall: put down at `land` s, picked up at `lift` s (INF: stays), its ground point
    `at` (world) and heading `yaw`; `strike` / `push` (degrees, + toes up) how it lands and how
    far the heel is up as it leaves (over the last `rise` s); `swivel` (t0, t1, yaw) turns it on
    its ball while down. The swing that brings it here: `arc` (a centre to go round, in the sense
    of the body's turn, further out from it by up to `wide` m half way; or None for straight;
    `body`: straight in the body's own frame, so the foot goes round with its hip as the body
    turns rather than cutting across under it, and out to its own side by up to `wide`), `run` (a running swing: off at once, at a nearly
    even speed after the first and before the last share `ramp` of it, kicked up by `kick`; more
    than the loops' 0.25, as a transition's swings are shorter and not yet or no longer at the
    loop's pace, so the loops' share would jolt the foot as it leaves and lands), `height` (m).
    `air`: how high the foot already is as it leaves (a clip that begins with a running foot in
    the air: that stance is where the loop has it at the start, lifting at once). `vel` (world
    m/s, y up), with `air`: a foot caught part way through a swing of the loop at that velocity;
    the swing that leaves it carries the velocity on and bends it into the next footfall instead
    of starting from rest."""
    return dict(land=land, lift=lift, at=flat(at), yaw=yaw, strike=strike * math.pi / 180, push=push * math.pi / 180, rise=rise,
                swivel=swivel, arc=arc, wide=wide, body=body, run=run, ramp=ramp, height=height, kick=kick, air=air, vel=vel)


def _down(s, t):
    """(ground point, heading, pitch) of a foot on the ground through stance s at t."""
    yaw, ground, pitch = s['yaw'], s['at'].copy(), 0.0
    if s['swivel']:
        t0, t1, yaw1, heel = s['swivel']
        x = mj(min(max(t, t0), t1), t0, t1)
        yaw = s['yaw'] + (yaw1 - s['yaw']) * x
        ball = s['at'] + turn(s['yaw']) @ BALL_FLAT  # the ball stays where it is; the heel swings
        ground = ball - turn(yaw) @ BALL_FLAT
        pitch -= heel * math.pi / 180 * math.sin(math.pi * x)
    if s['land'] > -INF:
        pitch += s['strike'] * (1 - ease((t - s['land']) / 0.1))
    if s['lift'] < INF and t > s['lift'] - s['rise']:
        pitch += s['push'] * ease((t - (s['lift'] - s['rise'])) / s['rise']) ** 1.6
    return ground, yaw, pitch


def _end(s):
    """Where a stance leaves its foot (after any swivel)."""
    ground, yaw, _ = _down(s, s['lift'] if s['lift'] < INF else s['land'])
    return ground, yaw


def _air(a, b, t, sense, root):
    """(ground point with the lift as y, heading, pitch) of a foot between stances a and b."""
    t1, t2 = a['lift'], b['land']
    sig = (t - t1) / (t2 - t1)
    start, yaw0 = _end(a)
    end, yaw1 = b['at'], b['yaw']
    if a['vel'] is not None:
        # caught mid-swing: the loop's velocity at first, bent smoothly into the landing (the
        # added term starts at that velocity and is gone, at rest, by the footfall)
        hand = (t2 - t1) * sig * (1 - sig) ** 3
        vel = a['vel']
        pos = start + (end - start) * min_jerk(sig) + flat(vel) * hand
        # (a foot caught low, just off the ground, still needs to clear it on the way)
        clear = max(0.0, 1 - a['air'] / b['height'])
        pos.y = a['air'] * (1 - min_jerk(sig)) + vel.y * hand + clear * b['height'] * math.sin(math.pi * sig) ** 2
        pitch = a['push'] * (1 - ease(sig / 0.55)) + b['strike'] * ease((sig - 0.35) / 0.65)
        return pos, yaw0 + (yaw1 - yaw0) * min_jerk(sig), pitch
    h = glide(sig, b['ramp']) if b['run'] else min_jerk((sig - 0.05) / 0.85)
    if b['body']:
        (r1, y1), (r2, y2), (rt, yt) = root(t1), root(t2), root(t)
        la, lb = turn(-y1) @ (start - flat(r1)), turn(-y2) @ (end - flat(r2))
        # (and out to its own side by up to `wide` half way, clear of the other foot)
        out = Vector((math.copysign(b['wide'], la.x + lb.x) * math.sin(math.pi * h), 0, 0))
        pos = flat(rt) + turn(yt) @ (la + (lb - la) * h + out)
    elif b['arc'] is not None:
        c = flat(b['arc'])
        va, vb = start - c, end - c
        pa, pb = math.atan2(va.x, va.z), math.atan2(vb.x, vb.z)
        delta = pb - pa
        while delta * sense < 0:
            delta += 2 * math.pi * sense
        r = va.length + (vb.length - va.length) * h + b['wide'] * math.sin(math.pi * h)
        phi = pa + delta * h
        pos = c + Vector((math.sin(phi) * r, 0, math.cos(phi) * r))
    else:
        pos = start + (end - start) * h
    if b['run']:
        lift = b['height'] * (1 - (1 - math.sin(math.pi * sig)) ** 2)
        lift += b['kick'] * (math.sin(0.5 * math.pi * sig / 0.35) if sig < 0.35 else 1 - ease((sig - 0.35) / 0.6))
    else:
        lift = b['height'] * (ease(sig / 0.22) if sig < 0.22 else 1 - ((sig - 0.22) / 0.78) ** 2.2)
    pos.y = lift + a['air'] * (1 - ease(sig / 0.5))
    pitch = a['push'] * (1 - ease(sig / 0.55)) + b['strike'] * ease((sig - 0.35) / 0.65)
    return pos, yaw0 + (yaw1 - yaw0) * min_jerk(sig), pitch


def foot_at(stances, t, root, sense=1.0):
    """(ground point with the lift as y, heading, pitch, on the ground) of one foot at t."""
    for k, s in enumerate(stances):
        if t <= s['lift']:
            if t >= s['land'] or k == 0:
                ground, yaw, pitch = _down(s, max(t, s['land']))
                return ground, yaw, pitch, True
            pos, yaw, pitch = _air(stances[k - 1], s, t, sense, root)
            return pos, yaw, pitch, False
    ground, yaw, pitch = _down(stances[-1], t)
    return ground, yaw, pitch, True


def build(author, seconds, root, steps, body, sense=1.0, run=False, hold='low'):
    """The clip's frames and notes. root(t) -> (ground point, heading) of the root in the world;
    steps {side: [stance, ...]}; body(t) -> dict(height (m, the hips' design height), pelvis
    (yaw against the root), pitch, roll (pelvis), lean (chest, rad), chest, head (yaw against the
    root), bank (the trunk's roll), shift (share of the way the hips go towards the feet that are
    down), back (hips behind the root, m))."""
    n = int(round(seconds * FPS)) + 1
    times = [i / FPS for i in range(n)]
    feet = {side: [foot_at(steps[side], t, root, sense) for t in times] for side in SIDES}
    roots = [root(t) for t in times]
    # the weight: towards the feet that are down, moving across ahead of a foot lifting
    pull = []
    for i in range(n):
        down = [feet[side][i][0] for side in SIDES if feet[side][i][3]]
        centre = sum(down, Vector()) / len(down) if down else roots[i][0]
        pull.append(flat(centre - roots[i][0]))
    sigma = 4.0
    r = int(sigma * 3)
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    smooth = [sum((w[k + r] * pull[min(n - 1, max(0, i + k))] for k in range(-r, r + 1)), Vector()) / sum(w) for i in range(n)]
    frames, design, out_root, out_down = [], [], [], []
    for i, t in enumerate(times):
        at, yaw = roots[i]
        b = body(t)
        back = turn(-yaw)
        hips_world = flat(at) + turn(yaw) @ Vector((0, 0, -b.get('back', 0.0))) + smooth[i] * b.get('shift', 0.3)
        hips = back @ (hips_world - flat(at))
        local_feet = {}
        for side in SIDES:
            ground, fyaw, pitch, _ = feet[side][i]
            g = back @ flat(ground - flat(at))
            g.y = ground.y
            local_feet[side] = (g, fyaw - yaw, pitch)
        hips_q = Quaternion((0, 1, 0), b.get('pelvis', 0.0)) @ Quaternion((1, 0, 0), b.get('pitch', 0.04)) @ Quaternion((0, 0, 1), b.get('roll', 0.0))
        local = author._upper(hips, hips_q, hold, lean=b['lean'], turn=b.get('chest', 0.0), roll=b.get('bank', 0.0),
                              head_pitch=b.get('nod', 2 * math.pi / 180))
        # the head looks where the body is going, ahead of the chest
        local['head'] = local['head'] @ Quaternion((0, 1, 0), b.get('head', 0.0) - b.get('chest', 0.0))
        frames.append({'hips': hips, 'local': local, 'feet': local_feet})
        design.append(b['height'])
        out_root.append([round(at.x, 5), round(at.z, 5), round(yaw, 5)])
        out_down.append([int(feet[side][i][3]) for side in SIDES])
    author._hips_height(frames, design, lift_swing=run, loop=False)
    author._gun(frames, hold=hold, loop=False)
    meta = dict(duration=(n - 1) / FPS, loop=False, frames=n, cycles=1, speed=0.0, direction=0.0, dir=[0, 0], root=out_root, down=out_down)
    return frames, meta


# ------------------------------------------------------------------ the loops these join

def _loop(gait):
    """What a forward loop's footfalls are like: speed, a cycle (s), how far ahead of the root a
    foot lands, how far apart the feet run across, and the share of a cycle each foot is down."""
    spec, v = (WALKS['f'], WALK_SPEED) if gait == 'walk' else (JOGS['f'], JOG_SPEED)
    cycle = spec['frames'] / CYCLES / FPS
    stride = v * cycle
    return dict(v=v, cycle=cycle, ahead=spec['land'] * stride * spec['beta'], half=(spec['width'] + WIDTH_ADD) / 2, beta=spec['beta'],
                lean=spec['lean'] * math.pi / 180, pitch=(2 + 1.5 + (3.0 if gait != 'walk' else 0.0)) * math.pi / 180,
                height=WALK_HIPS + (spec['hips'] if gait != 'walk' else 0.0))


def loop_phase(meta, side):
    """The loop's phase (cycles, as the game counts it) at its first landing of `side`'s foot."""
    return round(meta['contact'][side][0][0] * meta['cycles'], 5)


def _path(v0, profile, until):
    """Distance along the way over time for a speed profile v(t), integrated finely (before the
    start, at the speed v0)."""
    table, d, t, dt = [(0.0, 0.0)], 0.0, 0.0, 1 / 600
    while t < until + 0.5:
        d += 0.5 * (profile(t) + profile(t + dt)) * dt
        t += dt
        table.append((t, d))

    def at(x):
        if x < 0:  # before the clip: going at the speed it starts at
            return v0 * x
        k = min(len(table) - 1, int(round(x / dt)))
        return table[k][1]
    return at


# ------------------------------------------------------------------ turning on the spot

PIVOT_SECONDS = {45: 0.62, 90: 0.8, 135: 1.04, 180: 1.2}


def pivot(author, ready, degrees):
    """A turn on the spot of `degrees` (+ = left). The head and chest go first; the foot on the
    side of the turn opens towards the new way (on a big turn, part way first and the rest after),
    the weight goes onto it, and the other foot swings round it, outside it, to its place in the
    stance. The root turns with the pelvis and drifts a little towards the inside foot."""
    a = math.radians(degrees)
    s = 1.0 if a > 0 else -1.0
    inner, outer = ('Left', 'Right') if a > 0 else ('Right', 'Left')
    seconds = PIVOT_SECONDS[abs(degrees)]
    three = abs(degrees) > 100
    start = {side: (flat(ready[side][0]), ready[side][1]) for side in SIDES}
    shift = (start[inner][0] - turn(a) @ start[inner][0]) * 0.5
    final = {side: (shift + turn(a) @ start[side][0], start[side][1] + a) for side in SIDES}
    T = lambda u: u * seconds  # noqa: E731
    p0, y0 = start[inner]
    if three:
        # (the inside foot turns most of the way at its first step: with the outside foot down at
        # its new heading and this one still far round, the knees, which point where the feet do,
        # would come together)
        mid = (p0 + (final[inner][0] - p0) * 0.45, y0 + a * 0.75)
        steps = {inner: [stance(-INF, T(0.10), p0, y0, push=-8),
                         stance(T(0.34), T(0.70), mid[0], mid[1], height=0.035),
                         stance(T(0.90), INF, final[inner][0], final[inner][1], push=-6, height=0.03)],
                 outer: [stance(-INF, T(0.38), start[outer][0], start[outer][1], push=-12, rise=0.12),
                         stance(T(0.68), INF, final[outer][0], final[outer][1], arc=mid[0], wide=0.14, height=0.07)]}
    else:
        steps = {inner: [stance(-INF, T(0.14), p0, y0, push=-8),
                         stance(T(0.40), INF, final[inner][0], final[inner][1], height=0.035)],
                 outer: [stance(-INF, T(0.44), start[outer][0], start[outer][1], push=-12, rise=0.12),
                         stance(T(0.78), INF, final[outer][0], final[outer][1], arc=final[inner][0], wide=0.06, height=0.06)]}

    def root(t):
        u = t / seconds
        return shift * mj(u, 0.1, 0.85), a * mj(u, 0.06, 0.86)

    def body(t):
        u = t / seconds
        r = a * mj(u, 0.06, 0.86)
        chest = max(-0.45, min(0.45, a * mj(u, 0.0, 0.68) - r))
        head = chest + max(-0.7, min(0.7, a * mj(u, 0.0, 0.5) - r - chest))
        sink = bump(u, 0.05, 0.98)
        return dict(height=IDLE_HIPS - 0.016 - 0.025 * sink, pelvis=-0.10, pitch=0.04 + 0.02 * sink, lean=(3.0 + 2.0 * sink) * math.pi / 180,
                    chest=chest, head=head, bank=0.0, shift=0.3, back=0.02)

    frames, meta = build(author, seconds, root, steps, body, sense=s)
    meta.update(kind='pivot', angle=round(a, 5))
    return frames, meta


# ------------------------------------------------------------------ starts

def start(author, ready, gait, loop_meta):
    """Setting off forward from the ready stance. The weight goes onto the front (left) foot at
    once and the trunk tips forward as the body starts to move; the back foot drives off and
    takes the first, short step; the steps lengthen and quicken until the loop's own, and the
    clip ends on a footfall of the loop at its speed."""
    L = _loop(gait)
    v = L['v']
    walk = gait == 'walk'
    ramp = 0.62 if walk else 1.0  # s to the loop's speed
    seconds = 0.8 if walk else 0.92
    profile = lambda t: v * (1 - (1 - min(t, ramp) / ramp) ** 2)  # noqa: E731
    z = _path(0.0, profile, seconds)
    left, right = (flat(ready[side][0]) for side in SIDES)
    toe = 5 * math.pi / 180
    if walk:
        exit_side = 'Left'
        steps = {'Right': [stance(-INF, 0.13, right, ready['Right'][1], push=-22, rise=0.11),
                           stance(0.46, INF, Vector((-L['half'], 0, z(0.8) + L['ahead'] - 0.5)), -toe, strike=14)],
                 'Left': [stance(-INF, 0.50, left, ready['Left'][1], push=-30, rise=0.2),
                          stance(0.80, INF, Vector((L['half'], 0, z(0.8) + L['ahead'])), toe, strike=14)]}
    else:
        exit_side = 'Right'
        steps = {'Right': [stance(-INF, 0.10, right, ready['Right'][1], push=-25, rise=0.08),
                           stance(0.34, 0.56, Vector((-L['half'], 0, z(0.34) + 0.16)), -toe, strike=6, push=-42, rise=0.12, height=0.04),
                           stance(0.92, INF, Vector((-L['half'], 0, z(0.92) + L['ahead'])), -toe, strike=10, run=True, height=0.03, kick=0.18)],
                 'Left': [stance(-INF, 0.36, left, ready['Left'][1], push=-35, rise=0.2),
                          stance(0.66, 0.86, Vector((L['half'], 0, z(0.66) + 0.22)), toe, strike=10, push=-42, rise=0.11, run=True, height=0.03,
                                 kick=0.14),
                          # (in the air at the end, as the loop has it: its next footfall, the swing
                          # shaped as the loop's, which takes it over)
                          stance(1.23, INF, Vector((L['half'], 0, z(1.23) + L['ahead'])), toe, strike=10, run=True, ramp=LOOP_RAMP, height=0.03,
                                 kick=0.2)]}

    def root(t):
        return Vector((0, 0, z(t))), 0.0

    def body(t):
        u = t / seconds
        x = mj(u, 0.0, 0.9)
        drive = bump(t, 0.0, 0.5 if walk else 0.7)
        return dict(height=IDLE_HIPS + (L['height'] - IDLE_HIPS) * x - (0.012 if walk else 0.03) * drive,
                    pelvis=-0.10 * (1 - x), pitch=0.04 + (L['pitch'] - 0.04) * x, lean=3.0 * math.pi / 180 * (1 - x) + L['lean'] * x
                    + (6.0 if walk else 9.0) * math.pi / 180 * drive, shift=0.3 * (1 - x) + 0.15, back=0.02 * (1 - x))

    frames, meta = build(author, seconds, root, steps, body, run=not walk)
    meta.update(kind='start', gait=gait, exit=dict(gait=gait, side=exit_side, phase=loop_phase(loop_meta, exit_side), speed=round(profile(seconds), 4)))
    return frames, meta


# ------------------------------------------------------------------ stops

STOP_ENTRIES = 8  # stops per gait, one every eighth of the loop's cycle
STOP_BRAKE = {'walk': 0.45, 'jog': 0.55}  # s from the loop's speed to standing


def loop_feet(loop, phase):
    """Where a forward loop has each foot at `phase` (cycles; 0 = the left foot lands), in the root's
    frame at that moment, which is the world of a clip that begins there: ground point with the lift
    as y, world velocity (the loop is in place, so the ground's speed is added), heading, pitch,
    whether it is down, and how long (s) until it next lifts (if down) or lands (if not)."""
    frames, meta = loop
    n, v = meta['frames'], meta['speed']
    per = n / meta['cycles']

    def at(x):
        i = int(math.floor(x)) % n
        k = x - math.floor(x)
        f0, f1 = frames[i]['feet'], frames[(i + 1) % n]['feet']
        return {side: (f0[side][0].lerp(f1[side][0], k), f0[side][1] + (f1[side][1] - f0[side][1]) * k, f0[side][2] + (f1[side][2] - f0[side][2]) * k)
                for side in SIDES}
    x = phase * per
    now, ahead, behind = at(x), at(x + 0.5), at(x - 0.5)
    out = {}
    for side in SIDES:
        g, yaw, pitch = now[side]
        down = g.y <= 1e-6
        vel = (ahead[side][0] - behind[side][0]) * FPS + Vector((0, 0, v))
        k = 1
        while k < n and (frames[(int(math.ceil(x)) + k) % n]['feet'][side][0].y <= 1e-6) == down:
            k += 1
        until = (math.ceil(x) - x + k) / FPS
        # (in the air: where the loop puts it down, in the world)
        lands = frames[(int(math.ceil(x)) + k) % n]['feet'][side][0] + Vector((0, 0, v * until))
        out[side] = dict(at=g.copy(), vel=vel, yaw=yaw, pitch=pitch, down=down, until=until, lands=flat(lands))
    return out


def stop(author, ready, gait, entry, loop):
    """Stopping from the forward loop, from the moment the key is let go, at any point of the
    stride: the clip begins at the loop's phase `entry` / STOP_ENTRIES of a cycle, with both feet
    where the loop has them (one caught in the air carries its swing on), and the body brakes from
    the first frame, to standing in STOP_BRAKE s. The foot that brakes is the one down under or
    ahead of the body, or else the next to land, put down a little ahead; the other comes through
    (at a jog, a braking step and then one more), and whichever is not yet in the ready stance
    steps into it as the hips rise, the trunk, leant back against the brake, comes upright and
    settles."""
    L = _loop(gait)
    v = L['v']
    walk = gait == 'walk'
    phase = entry / STOP_ENTRIES
    brake_time = STOP_BRAKE[gait]
    profile = lambda t: v * (1 - min_jerk(t / brake_time))  # noqa: E731
    z = _path(v, profile, 2.0)
    end = z(brake_time)
    final = {side: Vector((ready[side][0].x, 0, end + ready[side][0].z)) for side in SIDES}
    feet = loop_feet(loop, phase)
    # the brake foot: one down not yet behind the body brakes now; otherwise the next to land
    # (running, only one just landed: under the body it is about to leave behind)
    planted = [side for side in SIDES if feet[side]['down'] and feet[side]['at'].z > (-0.04 if walk else 0.08)]
    landing = [side for side in SIDES if not feet[side]['down'] and feet[side]['until'] < 0.12]
    if planted and not landing:
        brake = max(planted, key=lambda side: feet[side]['at'].z)
        land_b = 0.0
    else:
        brake = min((side for side in SIDES if not feet[side]['down']), key=lambda side: feet[side]['until'])
        land_b = feet[brake]['until']
    other = 'Right' if brake == 'Left' else 'Left'
    gap = 0.3 if walk else 0.27  # s between footfalls (a little quicker than the loop's step)
    reach = 0.15 if walk else 0.2  # how far ahead of the slowing body a braking step lands

    def caught(side):
        """A foot in the air at the start, as the loop has it there."""
        f = feet[side]
        return stance(-INF, START_LIFT, flat(f['at']), f['yaw'], push=math.degrees(f['pitch']), air=f['at'].y, vel=f['vel'])

    # the footfalls, the feet in turn: the brake foot's (down already, or landing a little ahead of
    # where the slowing body now is), then braking steps while the body still has far to go, then
    # each foot into its place in the ready stance
    if land_b == 0.0:
        falls = [(brake, -INF, flat(feet[brake]['at']), feet[brake]['yaw'])]
    else:
        # (a little ahead of the slowing body; one nearly down already lands where the loop has it)
        lands = feet[brake]['lands']
        ahead = Vector((lands.x, 0, z(land_b) + L['ahead'] + 0.03))
        falls = [(brake, land_b, lands.lerp(ahead, min(1.0, land_b / 0.25)), feet[brake]['yaw'])]
    where = {brake: falls[0][2], other: None if not feet[other]['down'] else flat(feet[other]['at'])}
    t, side = max(land_b, 0.0), other
    while True:
        t += gap
        if side == other and len(falls) == 1:
            # (it leaves when the loop lifts it, and one already in the air lands no sooner than
            # the loop would land it)
            t = max(t, feet[other]['until'] + gap - 0.04) if feet[other]['down'] else max(t, feet[other]['until'])
        settled = end - z(t) < 0.18
        point = final[side] if settled else Vector((final[side].x, 0, z(t) + reach))
        if where[side] is None or (point - where[side]).length > 0.04:
            falls.append((side, t, point, ready[side][1] if settled else feet[side]['yaw']))
            where[side] = point
        if all(where[k] is not None and (where[k] - final[k]).length <= 0.04 for k in SIDES):
            break
        side = brake if side == other else other
    steps = {}
    for k in SIDES:
        mine = [(i, f) for i, f in enumerate(falls) if f[0] == k]
        seq = [] if mine and mine[0][1] == -INF else [caught(k) if not feet[k]['down'] else
                                                       stance(-INF, feet[k]['until'], flat(feet[k]['at']), feet[k]['yaw'], push=-30 if walk else -42, rise=0.12)]
        for j, (i, (_, land, point, yaw)) in enumerate(mine):
            last = j == len(mine) - 1
            # walking it leaves after the other foot is down; running, a moment before it lands
            nxt = next((f[1] for f in falls[i + 1:] if f[0] != k), None)
            lift = INF if last else (nxt + 0.06 if walk else max(land + 0.12, nxt - 0.07))
            seq.append(stance(land, lift, point, yaw, strike=0 if land == -INF else (14 if i == 0 else 8), push=0 if last else (-16 if walk else -36),
                              rise=0.1, height=0.04 if walk else 0.05, run=not walk, kick=0.0 if walk else 0.2))
        steps[k] = seq
    t = falls[-1][1]
    seconds = max(t + 0.25, brake_time + 0.3)

    def root(t):
        return Vector((0, 0, z(t))), 0.0

    def body(t):
        x = mj(t, 0.1, seconds)
        sit = bump(t, 0.0, brake_time + 0.3)
        height = L['height'] + (IDLE_HIPS - L['height']) * x - (0.015 if walk else 0.04) * sit
        return dict(height=height, pelvis=-0.10 * x, pitch=L['pitch'] + (0.04 - L['pitch']) * x,
                    lean=L['lean'] + (3.0 * math.pi / 180 - L['lean']) * mj(t, 0.0, brake_time) - (6.0 if walk else 10.0) * math.pi / 180 * sit,
                    shift=0.15 + 0.15 * x, back=0.02 * x)

    frames, meta = build(author, seconds, root, steps, body, run=not walk)
    meta.update(kind='stop', gait=gait, entry=dict(gait=gait, side=brake, phase=round(phase, 5), speed=v, cycle=round(L['cycle'], 5)))
    return frames, meta


# ------------------------------------------------------------------ the running about-turn

def run_turn(author, sense, loop_meta):
    """A running about-turn (`sense` + = round to the left), from the jog as the outside foot
    lands: it lands ahead, turned in, and brakes; the body sits back and banks into the turn while
    it swivels on that foot's ball; the inside foot swings round behind it and is put down for
    the drive; the body leans into the new way and pushes off; two running steps, and the clip
    ends on the inside foot's footfall going the other way at most of the jog's speed."""
    s = sense
    L = _loop('jog')
    v, half = L['v'], L['half']
    outer, inner = ('Right', 'Left') if s > 0 else ('Left', 'Right')
    stop_at, go = 0.26, 0.62  # s braking to a stop, s getting back up to speed
    v_out = 3.0
    seconds = 0.88

    def speed(t):  # along the old way: + forward, - back the other way
        return v * (1 - min_jerk(t / stop_at)) if t < stop_at else -v_out * min_jerk((t - stop_at) / go)
    z = _path(v, speed, seconds)
    x = lambda t: -s * 0.2 * mj(t, 0.04, 0.55)  # noqa: E731  the body goes round the planted foot
    yaw = lambda t: s * math.pi * mj(t, 0.0, 0.44)  # noqa: E731
    at = lambda t: Vector((x(t), 0, z(t)))  # noqa: E731
    # (where the game's run has the outside foot as it lands: measured, nearer the middle than the
    # loop's own line; the inside foot comes round it, so a plant further out here meets it there)
    plant = Vector((-s * 0.065, 0, 0.30))
    pi = math.pi
    # (the inside foot comes down beside the planted one on the far side of it: by then the body
    # has turned most of the way, so the legs are not crossed)
    steps = {
        outer: [stance(0.0, 0.42, plant, s * 0.35, strike=8, push=-20, rise=0.08, swivel=(0.04, 0.38, s * 2.45, 12)),
                # (lifting about a flight's length before the clip ends, as the loop it hands over to
                # has it, and before the game starts fading into that loop: a foot let go of while
                # the two are blended is let go between two places and jolts)
                stance(0.64, 0.74, at(0.64) + Vector((s * 0.075, 0, -0.2)), s * pi, strike=6, push=-42, rise=0.1, run=True, height=0.03,
                       kick=0.12),
                stance(1.18, INF, at(1.18) + Vector((s * 0.075, 0, -0.24)), s * pi, strike=10, run=True, ramp=LOOP_RAMP, height=0.03, kick=0.2)],
        inner: [stance(-INF, START_LIFT, Vector((s * half, 0, KICKED[0])), s * 0.09, push=-42, rise=0.1, air=KICKED[1]),
                stance(0.30, 0.52, Vector((-s * 0.44, 0, 0.42)), s * 2.8, push=-38, rise=0.12, body=True, wide=0.16, run=True, height=0.05,
                       kick=0.08),
                stance(0.88, INF, at(0.88) + Vector((-s * 0.075, 0, -0.2)), s * pi, strike=8, run=True, height=0.03, kick=0.15)],
    }

    def root(t):
        return at(t), yaw(t)

    def body(t):
        r = yaw(t)
        chest = max(-0.5, min(0.5, s * pi * mj(t, 0.0, 0.45) - r))
        head = chest + max(-0.6, min(0.6, s * pi * mj(t, 0.0, 0.32) - r - chest))
        sit = bump(t, 0.0, 0.42)
        drive = bump(t, 0.3, 0.86)
        return dict(height=L['height'] - 0.04 * sit, pelvis=-s * 0.12 * bump(t, 0.05, 0.5), pitch=L['pitch'],
                    lean=L['lean'] - 0.30 * sit + 0.12 * drive, chest=chest, head=head, bank=s * 0.12 * bump(t, 0.04, 0.6),
                    roll=s * 0.06 * bump(t, 0.04, 0.6), shift=0.2)

    frames, meta = build(author, seconds, root, steps, body, sense=s, run=True)
    meta.update(kind='runTurn', angle=round(s * math.pi, 5), plant=[round(plant.x, 4), round(plant.z, 4)],
                entry=dict(gait='jog', side=outer, phase=loop_phase(loop_meta, outer), speed=v),
                exit=dict(gait='jog', side=inner, phase=loop_phase(loop_meta, inner), speed=v_out))
    return frames, meta
