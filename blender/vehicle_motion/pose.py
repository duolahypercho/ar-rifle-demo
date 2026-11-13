"""Authoring a vehicle clip: key poses in the VEHICLE's frame (vehicles.py "V"), joined by cubic curves
(rifle_motion.handling.Keys), turned into rig frames in the character's root frame (the contract's
`root` track carries where the character stands or sits on the vehicle's ground plane).

A clip is a `Clip(veh, author, seconds, loop)` with channels set by its maker:

  pelvis      Keys of the pelvis translation (V)
  turn        Keys of (yaw, pitch, roll) of the pelvis, degrees: yaw = which way the body faces in V
              (the character's own convention: facing (sin yaw, 0, cos yaw); the cars face -Z, so
              seated yaw = 180), pitch + = tipped forward, roll + = right side down
  spine       Keys of (lean, twist, side) of the chest against the pelvis, degrees, shared up
              spine_01 / spine_03 / spine_05 as the rifle clips share it (0.3 / 0.35 / 0.35)
  look        Keys of (yaw, pitch) of the head in V, degrees: yaw against the pelvis's facing,
              pitch + = looking down; the neck takes half the bend, the head the rest
  collar      Keys of (left yaw, left roll, right yaw, right roll), degrees
  curl        Keys of (left, right), 0 open .. 1 the closed grip
  poles       Keys of (left xyz, right xyz): where each elbow points, chest frame (as the rifle clips)
  ctl         {control: Keys} (door 0..1, wheel deg, fwd / right / coll deg, pedal m)
  hands       {side: [steps]}:  ('hold', t0, t1, node, at, quat)  the palm's middle on `node` at `at`
                                (node frame) with the hand turned `quat` (node frame); node None = V
                                ('move', t0, t1, via, over)     from the hold before to the one after,
                                through `via` (V points), `over` m past the mark and back
  feet        {side: [steps]}:  ('plant', t0, t1, node, ground, yaw, pitch)  the ankle's ground point
                                (node frame; None = V), heading and pitch (deg, + toes up about the
                                heel, - heel up about the ball, the rig's roll)
                                ('step', t0, t1, lift, via)   to the next plant, `lift` m over the
                                straight line at the middle, through `via` (V ground points)
  root        None: from the pelvis (smoothed), pinned to `root0` / `root1` at the ends; or a callable
"""
import math

from mathutils import Matrix, Quaternion, Vector

from rifle_motion.carry import PALM_LOCAL, hand_quat
from rifle_motion.gait import ANKLE as ANKLE_G, FPS, foot, periodic_smooth
from rifle_motion.handling import Keys, QKeys, arrive, ease, min_jerk, smooth_poses, two_bone
from rifle_motion.skel import SIDE, ypr

DEG = math.pi / 180
Y = Vector((0, 1, 0))
SHARE = (('spine_01', 0.3), ('spine_03', 0.35), ('spine_05', 0.35))


def V3(*a):
    return Vector(a)


def hq(palm, fingers):
    """A hand's turn whose palm faces `palm` with the fingers along `fingers` (any frame)."""
    return hand_quat(palm, fingers)


def K(keys):
    """Keys from [(t, value...)] with tuples turned into Vectors."""
    out = []
    for k in keys:
        v = k[1]
        if isinstance(v, (tuple, list)):
            v = Vector(v)
        out.append((k[0], v) + tuple(k[2:]))
    return Keys(out)


def const(v):
    return K([(0.0, v)])


class Clip:
    def __init__(self, name, veh, author, seconds, loop=False):
        self.name, self.veh, self.author, self.seconds, self.loop = name, veh, author, seconds, loop
        self.skel = author.skel
        self.n = int(round(seconds * FPS)) + (0 if loop else 1)
        self.pelvis = self.turn = self.spine = self.look = None
        self.collar = const((0, 0, 0, 0))
        self.curl = const((1.0, 1.0))
        self.poles = None
        self.ctl = {}
        self.hands, self.feet = {}, {}
        self.root = None
        self.root0 = self.root1 = None
        self.events = {}
        self.contacts = []
        self.alive = None  # (t) -> dict of extra offsets added to the channels (the loops' life)
        self.knees = None  # (t) -> (left, right) directions in V each knee is bent towards (keys.py leaves the pole on the foot)
        self.finger_pose = None  # the closed hand (curl 1); None: the rifle grip
        self.warp = None  # (pass A3 round 2) [(clip time, authored time)...] increasing: the clip plays its authored
        # channels at a varying rate (a speed-limited time warp); None = authored time

    # ---------------------------------------------------------------- the time warp
    def W(self, u):
        """Authored time at clip time u."""
        if not self.warp:
            return u
        us, ts = zip(*self.warp)
        if u <= us[0]:
            return ts[0] + (u - us[0])
        for (u0, t0), (u1, t1) in zip(self.warp, self.warp[1:]):
            if u <= u1:
                return t0 + (t1 - t0) * (u - u0) / max(1e-9, u1 - u0)
        return ts[-1] + (u - us[-1])

    def Winv(self, t):
        """Clip time at authored time t."""
        if not self.warp:
            return t
        if t <= self.warp[0][1]:
            return self.warp[0][0] + (t - self.warp[0][1])
        for (u0, t0), (u1, t1) in zip(self.warp, self.warp[1:]):
            if t <= t1:
                return u0 + (u1 - u0) * (t - t0) / max(1e-9, t1 - t0)
        return self.warp[-1][0] + (t - self.warp[-1][1])

    def n_out(self):
        if not self.warp:
            return self.n
        return int(round(self.Winv((self.n - (0 if self.loop else 1)) / FPS) * FPS)) + (0 if self.loop else 1)

    def frames_of(self, t0, t1, n):
        """(first, last) clip frame of an authored span."""
        if not self.warp:
            return max(0, int(round(t0 * FPS))), min(n - 1, int(round(t1 * FPS)))
        # (warped: the frames inside the span, as clip frames fall at arbitrary authored instants)
        return max(0, int(math.ceil(self.Winv(t0) * FPS - 1e-6))), min(n - 1, int(math.floor(self.Winv(t1) * FPS + 1e-6)))

    # ---------------------------------------------------------------- per frame
    def controls(self, t):
        return {k: (v(t) if callable(v) else v) for k, v in self.ctl.items()}

    def body_frame(self, t):
        """(pass A2) The '@body' pseudo-node: the pelvis's place and heading (yaw only) in V at t, so a free
        hand can hang by the side and go with the body as it walks."""
        return self._frames_at(t)['@body']

    def _frames_at(self, t):
        """'@body' (the hips, heading only) and '@shoulder_l' / '@shoulder_r' (each shoulder joint, the same
        heading: a hand hanging under its shoulder goes with the trunk's lean)."""
        cache = self.__dict__.setdefault('_bf', {})
        key = round(t, 6)
        if key not in cache:
            local, hips = self.body_at(t)
            f = local['pelvis'] @ Vector((0, 0, 1))
            yaw = Matrix.Rotation(math.atan2(f.x, f.z), 4, 'Y')
            pos, _ = self.skel.fk(local, hips)
            _, rot = self.skel.fk(local, hips)
            cache[key] = {'@body': Matrix.Translation(hips) @ yaw, '@shoulder_l': Matrix.Translation(pos['upperarm_l']) @ yaw,
                          '@shoulder_r': Matrix.Translation(pos['upperarm_r']) @ yaw,
                          # (pass A4: the pelvis and the chest with their whole turn, for limbs that go with a rolling body)
                          '@pelvis': Matrix.Translation(hips) @ rot['pelvis'].to_matrix().to_4x4(),
                          '@chest': Matrix.Translation(pos['spine_05']) @ rot['spine_05'].to_matrix().to_4x4()}
        return cache[key]

    def node_frame(self, node, t, ctl):
        if node is None:
            return Matrix.Identity(4)
        if node in ('@body', '@shoulder_l', '@shoulder_r', '@pelvis', '@chest'):
            return self._frames_at(t)[node]
        return self.veh.world(node, ctl)

    def _hold(self, step, t, ctl):
        _, t0, t1, node, at, q = step[:6]
        if node is None:
            return Vector(at), Quaternion(q)
        m = self.node_frame(node, t, ctl)
        return m @ Vector(at), (m.to_quaternion() @ Quaternion(q)).normalized()

    def axis_of(self, side, t, ctl):
        """(point on the handle's axis, axis direction) in V if the hand holds a handle it may roll
        round at t (a hold step with an 8th item: the axis in the node's frame, through `centre` = the
        7th item), else None."""
        for step in self.hands[side]:
            if step[0] == 'hold' and step[1] - 1e-9 <= t <= step[2] + 1e-9 and len(step) > 7:
                m = self.node_frame(step[3], t, ctl)
                lim = step[8] if len(step) > 8 else 150
                return m @ Vector(step[6]), (m.to_3x3() @ Vector(step[7])).normalized(), lim
        return None

    def wrist_angles(self, side, palm, q, pos, rot, pole_dir):
        sign = 1 if side == 'Left' else -1
        s = SIDE[side]
        upper = self.skel.rest['lowerarm_' + s].length
        fore = self.skel.rest['hand_' + s].length
        wrist = palm - q @ PALM_LOCAL
        shoulder = pos['upperarm_' + s]
        elbow = two_bone(shoulder, wrist, upper, fore, shoulder + rot['spine_05'] @ pole_dir)
        d = q.inverted() @ (wrist - elbow).normalized()
        flex = math.degrees(math.atan2(-d.z, -d.y))
        dev = -math.degrees(math.atan2(d.x, -d.y)) * sign
        return flex, dev

    def roll_on_handles(self, V):
        """A hand on a handle (hold steps with an axis) rolls round it to keep its wrist straightest
        (flexion and deviation weighed as the review limits them: 60 / 45), the roll smoothed over the
        clip: the palm stays on the handle's surface at the same distance from its axis."""
        n = len(V)
        for v in V:
            v['hands0'] = dict(v['hands'])
        for side in ('Left', 'Right'):
            rolls = [None] * n
            for i, v in enumerate(V):
                ax = self.axis_of(side, v['t'], v['ctl'])
                if ax is None:
                    continue
                centre, axis, lim = ax
                palm, q = v['hands'][side]
                pos, rot = self.skel.fk(v['local'], v['hips'])
                pole = v['poles'][0 if side == 'Left' else 1]

                def cost(ab):
                    a, b = ab
                    turn = Quaternion(axis, math.radians(a))
                    q2 = (turn @ q).normalized()
                    # (b: the hand turned about its palm's normal, a diagonal grip, within 35 deg)
                    q2 = (q2 @ Quaternion((0, 0, 1), math.radians(b))).normalized()
                    p2 = centre + turn @ (palm - centre)
                    f, d = self.wrist_angles(side, p2, q2, pos, rot, pole)
                    return (f / 60.0) ** 2 + (d / 45.0) ** 2 + (b / 60.0) ** 2 * 0.3
                cand = [(a, b) for a in range(-lim, lim + 1, 10) for b in range(-35, 36, 7)]
                lo = min(cand, key=cost)
                for step in (5, 2, 1):
                    lo = min(((lo[0] + da, max(-35, min(35, lo[1] + db))) for da in (-step, 0, step) for db in (-step, 0, step)), key=cost)
                rolls[i] = lo
            idx = [i for i in range(n) if rolls[i] is not None]
            if not idx:
                continue
            loop = self.loop and len(idx) == n
            if getattr(self, 'smooth_runs', False) and not loop:
                # (pass A2, opt-in) each run of consecutive frames on a handle smoothed on its own: a hold's roll
                # takes nothing from an earlier hold seconds before
                sa, sb, r0 = [], [], 0
                for k in range(1, len(idx) + 1):
                    if k == len(idx) or idx[k] != idx[k - 1] + 1:
                        run = idx[r0:k]
                        sa += periodic_smooth([rolls[i][0] for i in run], 3.0, False) if len(run) > 1 else [rolls[run[0]][0]]
                        sb += periodic_smooth([rolls[i][1] for i in run], 3.0, False) if len(run) > 1 else [rolls[run[0]][1]]
                        r0 = k
            else:
                sa = periodic_smooth([rolls[i][0] for i in idx], 3.0, loop) if len(idx) > 1 else [rolls[idx[0]][0]]
                sb = periodic_smooth([rolls[i][1] for i in idx], 3.0, loop) if len(idx) > 1 else [rolls[idx[0]][1]]
            if getattr(self, 'fixed_roll', False):
                # (pass A2) one roll per hold: the palm stays on one point of the handle (the contact's point)
                groups = {}
                for k, i in enumerate(idx):
                    groups.setdefault(self._plan_step(side, V[i]['t'])[1:3], []).append(k)
                for ks in groups.values():
                    ma = sum(sa[k] for k in ks) / len(ks)
                    mb = sum(sb[k] for k in ks) / len(ks)
                    for k in ks:
                        sa[k], sb[k] = ma, mb
            for i, a, b in zip(idx, sa, sb):
                v = V[i]
                centre, axis, _ = self.axis_of(side, v['t'], v['ctl'])
                palm, q = v['hands'][side]
                turn = Quaternion(axis, math.radians(a))
                q2 = ((turn @ q).normalized() @ Quaternion((0, 0, 1), math.radians(b))).normalized()
                v['hands'][side] = (centre + turn @ (palm - centre), q2)
                v.setdefault('rolls', {})[side] = (a, b)
        self.carry_rolls(V)
        self.natural_moves(V)

    def natural_moves(self, V):
        """(pass A2) A hand travelling between holds turns with its forearm (no wrist bend) in the middle of the
        move, easing from and into the holds' own turns over the first and last third."""
        from rifle_motion.handling import two_bone
        for side in ('Left', 'Right'):
            s = SIDE[side]
            upper = self.skel.rest['lowerarm_' + s].length
            fore = self.skel.rest['hand_' + s].length
            plan = self.hands[side]
            free = lambda st: st[0] == 'hold' and str(st[3]).startswith('@')  # noqa: E731  (a hand by the side, on the body)
            last_free = None
            prev = None  # (pass A2) the last frame's forearm-aligned turn: aligned from it, no flip at 180 degrees
            for i, v in enumerate(V):
                step = self._plan_step(side, v['t'])
                if free(step):
                    w = 1.0
                elif step[0] != 'move' or (len(step) > 5 and step[5] == 'plain'):
                    prev = None
                    continue
                else:
                    k = plan.index(step)
                    t0, t1 = step[1], step[2]
                    x = (v['t'] - t0) / max(1e-6, t1 - t0)
                    a_free = k > 0 and free(plan[k - 1])
                    b_free = k + 1 < len(plan) and free(plan[k + 1])
                    wa = 1.0 if a_free else ease(min(1.0, 3.0 * x))
                    wb = 1.0 if b_free else ease(min(1.0, 3.0 * (1.0 - x)))
                    w = min(wa, wb)
                if w <= 0:
                    continue
                palm, q = v['hands'][side]
                if step[0] == 'move' and a_free and last_free is not None:
                    # (from where the free hand really was, not its authored turn)
                    j = min(len(V) - 1, int(math.ceil(self.Winv(t1) * FPS - 1e-6)))
                    qe = V[j]['hands'][side][1]
                    if last_free.dot(qe) < 0:
                        qe = -qe
                    q = last_free.slerp(qe, ease(x)).normalized()
                pos, rot = self.skel.fk(v['local'], v['hips'])
                pole = v['poles'][0 if side == 'Left' else 1]
                q2 = prev if prev is not None else q
                for _ in range(2):
                    wrist = palm - q2 @ PALM_LOCAL
                    sh = pos['upperarm_' + s]
                    elbow = two_bone(sh, wrist, upper, fore, sh + rot['spine_05'] @ Vector(pole))
                    d = (wrist - elbow).normalized()
                    q2 = ((q2 @ Vector((0, -1, 0))).rotation_difference(d) @ q2).normalized()
                # the turn about the forearm goes towards the authored one's, at most 12 deg a frame
                qt = ((q @ Vector((0, -1, 0))).rotation_difference(d) @ q).normalized()
                r = (qt @ q2.inverted()).normalized()
                if r.w < 0:
                    r = -r
                tw = 2 * math.atan2(Vector((r.x, r.y, r.z)).dot(d), r.w)
                # (pass A4: 12 deg per AUTHORED frame: a warped clip's frames lie further apart in authored time, and a
                # per-frame cap made the hand lag its authored turn and snap onto the hold's turn at the end)
                cap = math.radians(12) * (max(1.0, (v['t'] - V[i - 1]['t']) * FPS) if i > 0 else 1.0)
                tw = max(-cap, min(cap, tw))
                q2 = (Quaternion(d, tw) @ q2).normalized()
                prev = q2
                if q.dot(q2) < 0:
                    q2 = -q2
                v['hands'][side] = (palm, q.slerp(q2, w).normalized())
                if free(step):
                    last_free = v['hands'][side][1]

    def carry_rolls(self, V):
        """(pass A2) A hand moving between two holds starts and ends with the turn the roll gave it at those
        holds: the roll's change (rotation and palm offset) is blended across the move, so nothing jumps at the
        joins."""
        n = len(V)
        for side in ('Left', 'Right'):
            kind = []
            for v in V:
                if side in v.get('rolls', {}):
                    kind.append('R')
                else:
                    step = self._plan_step(side, v['t'])
                    kind.append('M' if step[0] == 'move' else 'H')

            def delta(i):
                if kind[i] != 'R':
                    return Vector(), Quaternion()
                (p1, q1), (p0, q0) = V[i]['hands'][side], V[i]['hands0'][side]
                return p1 - p0, (q1 @ q0.inverted()).normalized()
            i = 0
            while i < n:
                if kind[i] != 'M':
                    i += 1
                    continue
                j = i
                while j < n and kind[j] == 'M':
                    j += 1
                a, b = i - 1, j  # the frames either side of the move
                da = delta(a) if a >= 0 else (Vector(), Quaternion())
                db = delta(b) if b < n else (Vector(), Quaternion())
                if da[1].dot(db[1]) < 0:
                    db = (db[0], -db[1])
                for k in range(i, j):
                    x = ease((k - a) / max(1, b - a))
                    p0, q0 = V[k]['hands0'][side]
                    dq = da[1].slerp(db[1], x)
                    V[k]['hands'][side] = (p0 + da[0].lerp(db[0], x), (dq @ q0).normalized())
                i = j

    def _plan_step(self, side, t):
        for step in self.hands[side]:
            if step[0] == 'hold' and step[1] - 1e-9 <= t <= step[2] + 1e-9:
                return step
        for step in self.hands[side]:
            if step[1] <= t <= step[2]:
                return step
        return ('hold',)

    def _plan(self, plan, t, ctl, hold, between):
        for k, step in enumerate(plan):
            if step[1] - 1e-9 <= t <= step[2] + 1e-9 and step[0] in ('hold', 'plant'):
                return hold(step, t, ctl), k
        for k, step in enumerate(plan):
            if step[1] <= t <= step[2]:
                return between(plan, k, t, ctl), k
        raise ValueError(f'{self.name}: no step covers t={t:.3f}')

    def hand_at(self, side, t, ctl):
        plan = self.hands[side]

        def between(plan, k, t, ctl):
            step = plan[k]
            _, t0, t1, via, over = step[:5]
            a = self._hold(plan[k - 1], t0, self.controls(t0))
            b = self._hold(plan[k + 1], t, ctl)
            x = (t - t0) / (t1 - t0)
            pts = [a[0]] + [Vector(v) for v in via] + [b[0]]
            lengths = [0.0]
            for p, q in zip(pts, pts[1:]):
                lengths.append(lengths[-1] + max(1e-4, (q - p).length))
            path = Keys([(lengths[j] / lengths[-1], pts[j]) for j in range(len(pts))])
            u = arrive(x, over / lengths[-1]) if over else min_jerk(x)
            p = path(min(1.0, u)) if u <= 1 else pts[-1] + (pts[-1] - path(0.97)).normalized() * (u - 1) * lengths[-1]
            q = a[1].slerp(b[1], ease(min(1.0, x * 1.15)))
            return p, q
        return self._plan(plan, t, ctl, self._hold, between)[0]

    def _plant(self, step, t, ctl):
        _, t0, t1, node, ground, yaw, pitch = step[:7]
        g = Vector(ground) if node is None else self.veh.world(node, ctl) @ Vector(ground)
        return g, yaw, pitch

    def foot_at(self, side, t, ctl):
        plan = self.feet[side]

        def between(plan, k, t, ctl):
            _, t0, t1, lift, via = plan[k][:5]
            a = self._plant(plan[k - 1], t0, self.controls(t0))
            b = self._plant(plan[k + 1], t1, self.controls(t1))
            x = (t - t0) / (t1 - t0)
            # (pass A3, opt-in `step_clear` = c: the foot goes straight up off its place for the first c of the step
            # and straight down onto the next for the last c, moving along its path only between: no slide while
            # it is near the surface)
            c0 = getattr(self, 'step_clear_at', {}).get(round(t0, 3), getattr(self, 'step_clear', 0.0))  # (pass A4: per step)
            u = min_jerk((x - c0) / (1.0 - 2.0 * c0)) if c0 else min_jerk(x)
            pts = [a[0]] + [Vector(v) for v in via] + [b[0]]
            lengths = [0.0]
            for p, q in zip(pts, pts[1:]):
                lengths.append(lengths[-1] + max(1e-4, (q - p).length))
            path = Keys([(lengths[j] / lengths[-1], pts[j]) for j in range(len(pts))])
            g = path(u)
            g.y += lift * math.sin(math.pi * x) ** 2 * 1.0
            yaw = a[1] + (b[1] - a[1]) * ease(x)
            # (the foot leaves on its ball, rolls flat in the air and lands as it is planted)
            pitch = a[2] * (1 - ease(x / 0.35)) + b[2] * ease((x - 0.65) / 0.35) if len(plan[k]) < 6 else plan[k][5](x)
            return g, yaw, pitch
        return self._plan(plan, t, ctl, self._plant, between)[0]

    def body_at(self, t):
        """Canonical locals and the pelvis translation in V (no fingers) at t."""
        extra = self.alive(t) if self.alive else {}
        hips = self.pelvis(t) + extra.get('pelvis', Vector())
        bal = self.__dict__.get('_bal')
        if bal:
            x = max(0.0, min(len(bal) - 1.0, t * FPS))
            k = int(x)
            hips = hips + bal[k].lerp(bal[min(k + 1, len(bal) - 1)], x - k)
        yaw, pitch, roll = self.turn(t) + extra.get('turn', Vector())
        lean, twist, side = self.spine(t) + extra.get('spine', Vector())
        local = {'pelvis': ypr(yaw * DEG, pitch * DEG, roll * DEG)}
        for name, k in SHARE:
            local[name] = ypr(twist * k * DEG, lean * k * DEG, side * k * DEG)
        c = self.collar(t) + extra.get('collar', Vector((0, 0, 0, 0)))
        local['clavicle_l'] = ypr(c[0] * DEG, 0, c[1] * DEG)
        local['clavicle_r'] = ypr(c[2] * DEG, 0, -c[3] * DEG)
        _, rot = self.skel.fk(local, hips)
        ly, lp = self.look(t) + extra.get('look', Vector((0, 0)))
        want = ypr((yaw + ly) * DEG, lp * DEG, 0.0)
        bend = rot['spine_05'].inverted() @ want
        local['neck_01'] = Quaternion().slerp(bend, 0.5)
        local['head'] = local['neck_01'].inverted() @ bend
        return local, hips

    # ---------------------------------------------------------------- the clip
    def roots(self, pelv, yaws):
        n = self.n_out()
        if self.root is not None:
            return [self.root(self.W(i / FPS)) for i in range(n)]
        xs = periodic_smooth([p.x for p in pelv], 4.0, self.loop)
        zs = periodic_smooth([p.z for p in pelv], 4.0, self.loop)
        un = [yaws[0]]
        for a in yaws[1:]:
            un.append(a + 2 * math.pi * round((un[-1] - a) / (2 * math.pi)))
        ys = periodic_smooth(un, 4.0, self.loop)
        out = []
        for i in range(n):
            s = ease(i / max(1, n - 1))
            r = [xs[i], zs[i], ys[i]]
            if self.root0 is not None:
                d0 = [a - b for a, b in zip(self.root0, (xs[0], zs[0], ys[0]))]
                d1 = [a - b for a, b in zip(self.root1, (xs[-1], zs[-1], ys[-1]))]
                r = [r[k] + d0[k] * (1 - s) + d1[k] * s for k in range(3)]
            out.append(r)
        return out

    def supports(self, t, ctl, hips):
        """(pass A2) The support's points (x, z) at t: each planted foot's heel and toe, each hand on a
        vehicle hold, the seat under the hips (self.seat_area: (x0, x1), (z0, z1), highest pelvis y)."""
        pts = []
        for side in ('Left', 'Right'):
            for step in self.feet[side]:
                if step[0] == 'plant' and step[1] - 1e-9 <= t <= step[2] + 1e-9:
                    g, yaw, _ = self._plant(step, t, ctl)
                    f = Quaternion(Y, yaw * DEG) @ Vector((0, 0, 1))
                    pts += [(g + f * -0.06).xz, (g + f * 0.17).xz, (g + f * 0.06 + Quaternion(Y, yaw * DEG) @ Vector((0.045, 0, 0))).xz,
                            (g + f * 0.06 - Quaternion(Y, yaw * DEG) @ Vector((0.045, 0, 0))).xz]
            for step in self.hands[side]:
                if step[0] == 'hold' and step[1] - 1e-9 <= t <= step[2] + 1e-9 and step[3] is not None and not str(step[3]).startswith('@'):
                    pts.append(self._hold(step, t, ctl)[0].xz)
        area = getattr(self, 'seat_area', None)
        if area:
            (x0, x1), (z0, z1), ymax = area
            if x0 <= hips.x <= x1 and z0 <= hips.z <= z1 and hips.y <= ymax:
                px, pf, pb = getattr(self, 'seat_pad', (0.1, 0.1, 0.1))
                f = self.turn(t)[0] * DEG
                fw, rt = Vector((math.sin(f), 0, math.cos(f))), Vector((math.cos(f), 0, -math.sin(f)))
                pts += [(hips + rt * dx + fw * dz).xz for dx in (-px, px) for dz in (-pb, pf)]
        return [tuple(p) for p in pts]

    def com_estimate(self, t, ctl, local, hips):
        pos, _ = self.skel.fk(local, hips)
        c = 0.497 * (pos['pelvis'] + pos['neck_01']) / 2 + 0.081 * pos['head']
        for side, s in (('Left', 'l'), ('Right', 'r')):
            g, yaw, pitch = self.foot_at(side, t, ctl)
            c += 0.161 * (0.6 * pos['thigh_' + s] + 0.4 * (g + Vector((0, 0.08, 0))))
            c += 0.05 * (0.5 * pos['upperarm_' + s] + 0.5 * self.hand_at(side, t, ctl)[0])
        return c / (0.497 + 0.081 + 2 * 0.161 + 2 * 0.05)

    def plan_balance(self, inset=0.03, sigma=4.0):
        """(pass A2) Shifts the hips (x, z) so the centre of mass (estimated: trunk, head, legs to the planned
        feet, arms to the planned hands) stays over the support (supports()) `inset` m inside its edge,
        smoothed; nothing moves where it already is."""
        self._bal = None
        offs = []
        for i in range(self.n):
            t = i / FPS
            ctl = self.controls(t)
            local, hips = self.body_at(t)
            pts = self.supports(t, ctl, hips)
            c = self.com_estimate(t, ctl, local, hips)
            area = getattr(self, 'seat_area', None)
            seated = area and area[0][0] <= hips.x <= area[0][1] and area[1][0] <= hips.z <= area[1][1] and hips.y <= area[2] and (
                t >= getattr(self, 'seated_from', 1e9) or t <= getattr(self, 'seated_before', -1.0))
            offs.append((0.0, 0.0) if seated else _shift_into(c.xz, pts, inset))  # (sitting: the seat holds the weight)
            if any(a0 <= t <= a1 for a0, a1 in getattr(self, 'balance_skip', ())):
                offs[-1] = (0.0, 0.0)  # (pass A2, opt-in: a climb held by the hands; the balance is reported, not planned)
        # (the weight goes over before a foot lifts and stays until it is down: the largest shift within
        # `lead` frames either side, then smoothed)
        lead = int(getattr(self, 'balance_lead', 7))
        held = []
        for i in range(len(offs)):
            win = offs[max(0, i - lead):i + lead + 1]
            held.append(max(win, key=lambda o: o[0] * o[0] + o[1] * o[1]))
        xs = periodic_smooth([o[0] for o in held], sigma, False)
        zs = periodic_smooth([o[1] for o in held], sigma, False)
        self._bal = [Vector((x, 0.0, z)) for x, z in zip(xs, zs)]
        self.__dict__.pop('_bf', None)

    def make(self, carry, carry2):
        """(frames in the root's frame, meta, per-frame V data for the review)."""
        n = self.n_out()
        if getattr(self, 'balance', False):
            self.plan_balance()
        fingers = self.finger_pose or self.author.fingers
        V = []
        for i in range(n):
            t = self.W(i / FPS)
            ctl = self.controls(t)
            local, hips = self.body_at(t)
            hands = {s: self.hand_at(s, t, ctl) for s in ('Left', 'Right')}
            feet = {s: self.foot_at(s, t, ctl) for s in ('Left', 'Right')}
            curl = self.curl(t)
            V.append(dict(t=t, ctl=ctl, local=local, hips=hips, hands=hands, feet=feet, curl={'Left': curl[0], 'Right': curl[1]},
                          poles=self.poles(t)))
        self.roll_on_handles(V)
        roots = self.roots([v['hips'] for v in V], [math.atan2(*(v['local']['pelvis'] @ Vector((0, 0, 1))).xz) for v in V])
        frames = []
        for i, v in enumerate(V):
            x, z, yaw = roots[i]
            turn = Quaternion(Y, -yaw)
            off = Vector((x, 0, z))
            to_root = lambda p: turn @ (p - off)  # noqa: E731
            local = dict(v['local'])
            local['pelvis'] = (turn @ local['pelvis']).normalized()
            for side in ('Left', 'Right'):
                for name, q in fingers.items():
                    if name.endswith('_' + SIDE[side]):
                        local[name] = Quaternion().slerp(q, max(0.0, min(1.0, v['curl'][side])))
            hips = to_root(v['hips'])
            hands = {}
            for side, (palm, q) in v['hands'].items():
                hqr = (turn @ q).normalized()
                hands[side] = (to_root(palm) - hqr @ PALM_LOCAL, hqr)
            feet = {}
            for side, ft in v['feet'].items():
                g, fyaw, pitch = ft[:3]
                feet[side] = (to_root(g), fyaw * DEG - yaw, pitch * DEG)
                if len(ft) > 3:  # (pass A4: a foot turned whole (airborne, rolling): its turn in V, the ankle turning about its ground point)
                    feet[side] = (to_root(g), 0.0, 0.0, (turn @ ft[3]).normalized())
            pos, rot = self.skel.fk(local, hips)
            if self.knees is not None:
                from rifle_motion.gait import foot as foot_of
                kd = self.knees(v['t'])
                knees = {}
                for k, side in enumerate(('Left', 'Right')):
                    g, fy, fp = feet[side][:3]
                    ankle = foot_of(g, fy, fp)[0] if len(feet[side]) < 4 else g + feet[side][3] @ ANKLE_G
                    mid = (pos['thigh_' + SIDE[side]] + ankle) / 2
                    knees[side] = mid + (turn @ Vector(kd[k])).normalized() * 1.0
            p = (lambda s: (Vector(s[0]), Vector(s[1])))(v['poles'])
            knees_w = kd[2] if self.knees is not None and len(kd) > 2 else 1.0  # (pass A2: 0 = the pole at its rest on the foot)
            f = dict(local=local, hips=hips, hands=hands, feet=feet, poles={'Left': p[0], 'Right': p[1]},
                     knees=knees if self.knees is not None else None, knees_w=knees_w,
                     curl=v['curl'], gun=carry.stowed(pos['spine_05'], rot['spine_05']), gun2=carry2.stowed(pos['spine_05'], rot['spine_05']))
            frames.append(f)
        if getattr(self, 'auto_contacts', None):
            self.contacts = self.contacts_from_plans(V)
        # a hand contact's point: where the palm actually is on its node (after the roll), its mean
        for c in self.contacts:
            if c['part'].startswith('hand') and c['node'] and c.get('kind') != 'fixed':
                side = 'Left' if c['part'] == 'hand_l' else 'Right'
                pts = [self.veh.world(c['node'], V[i]['ctl']).inverted() @ V[i]['hands'][side][0] for i in range(c['from'], min(c['to'], n - 1) + 1)]
                if pts:
                    c['at'] = [round(x, 4) for x in sum(pts, Vector()) / len(pts)]
        door = [round(v['ctl'].get('door', 0.0), 4) for v in V]
        meta = dict(duration=(n - (0 if self.loop else 1)) / FPS, loop=self.loop, frames=n, cycles=1, speed=0.0, direction=0.0, dir=[0, 0],
                    contact={'Left': [[0.0, 1.0]], 'Right': [[0.0, 1.0]]}, leftStrike=None,
                    root=[[round(r[0], 5), round(r[1], 5), round(r[2], 6)] for r in roots],
                    vehicle=self.veh.kind, events={k: (round(self.Winv(v), 4) if isinstance(v, (int, float)) and self.warp else v) for k, v in self.events.items()},
                    door=door, contacts=self.contacts,
                    shift={'Gun': carry.shift.copy()})
        return frames, meta, V, roots


def _shift_into(p, pts, inset):
    """(dx, dz) that brings the 2D point p `inset` inside the convex hull of pts (0, 0 if it is)."""
    from .judge_a2 import _hull
    h = _hull(pts)
    if len(h) < 3:
        return (0.0, 0.0)
    cx = sum(q[0] for q in h) / len(h)
    cz = sum(q[1] for q in h) / len(h)
    # shrink the hull towards its centre by `inset` (approximately) and find the nearest point on it
    small = []
    for q in h:
        dx, dz = q[0] - cx, q[1] - cz
        d = math.hypot(dx, dz)
        k = max(0.0, d - inset) / d if d > 1e-9 else 0.0
        small.append((cx + dx * k, cz + dz * k))
    inside = all((small[(i + 1) % len(small)][0] - small[i][0]) * (p[1] - small[i][1]) - (small[(i + 1) % len(small)][1] - small[i][1]) * (p[0] - small[i][0]) >= 0
                 for i in range(len(small)))
    if inside:
        return (0.0, 0.0)
    best, bd = None, math.inf
    for i in range(len(small)):
        a, b = small[i], small[(i + 1) % len(small)]
        ax, az = b[0] - a[0], b[1] - a[1]
        L = ax * ax + az * az
        u = 0.0 if L < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / L))
        q = (a[0] + u * ax, a[1] + u * az)
        d = math.hypot(p[0] - q[0], p[1] - q[1])
        if d < bd:
            best, bd = q, d
    return (best[0] - p[0], best[1] - p[1])


def ground_for_ball(ball, yaw_deg, pitch_deg):
    """The ankle's ground point that puts the sole under the ball at `ball` (V) with the foot turned
    `yaw_deg` and pitched `pitch_deg` (+ toes up about the heel, - heel up about the ball): the
    inverse of rifle_motion.gait.foot's roll."""
    from rifle_motion.gait import BALL, HEEL
    turn = Quaternion((0, 1, 0), yaw_deg * DEG)
    roll = Quaternion((1, 0, 0), -pitch_deg * DEG)
    sole = Vector((BALL.x, 0.0, BALL.z))  # the sole under the ball (a shoe's ball pivot sits above it)
    pivot = HEEL if pitch_deg >= 0 else BALL
    return Vector(ball) - turn @ (pivot + roll @ (sole - pivot))


def sole_points(ground, yaw_deg, pitch_deg):
    """(heel, ball) sole points (V) of a planted foot."""
    from rifle_motion.gait import BALL, HEEL
    turn = Quaternion((0, 1, 0), yaw_deg * DEG)
    roll = Quaternion((1, 0, 0), -pitch_deg * DEG)
    pivot = HEEL if pitch_deg >= 0 else BALL
    sole = Vector((BALL.x, 0.0, BALL.z))
    return (Vector(ground) + turn @ (pivot + roll @ (HEEL - pivot)), Vector(ground) + turn @ (pivot + roll @ (sole - pivot)))



def wheel_grip(fingers):
    """A closed hand round a rim or a stick (about 3 cm thick): every finger wrapped (the rifle grip's
    trigger finger lies straight along the receiver), flexion about the finger's -X as the grip has it,
    the thumbs as the rifle grip closes them."""
    flex = {'index': (58, 70, 38), 'middle': (60, 72, 40), 'ring': (62, 74, 40), 'pinky': (64, 74, 38)}
    out = dict(fingers)
    for name in fingers:
        part = name.split('_')[0]
        if part in flex:
            j = int(name.split('_')[1]) - 1
            out[name] = Quaternion((-1, 0, 0), math.radians(flex[part][j]))
    return out



def warp_of(clip):
    """(pass A3 round 2) The clip's speed-limited time warp, or None. (pass A4: from warps_a4.json, the fast clips'
    warps (warp_a4.py); the A3 warps (warps_a3.json) were for the slow clips A4 replaced and are no longer read. Key
    '<name>' for Tripo, 'ue5:<name>' for civilian-m-01-player-ue5; A4_WARPS names another file.)"""
    import json
    import pathlib
    from rifle_motion import body as body_table
    import os
    f = pathlib.Path(os.environ.get('A4_WARPS') or pathlib.Path(__file__).with_name('warps_a4.json'))
    if not f.exists():
        return None
    w = json.loads(f.read_text())
    pre = 'ue5:' if body_table.T.get('name') == 'civilian-m-01-player-ue5' else ''
    keys = w.get(pre + clip.name)
    if not keys:
        return None
    # (the clip's end on a whole frame: the last key moved to the nearest one, the rest as they are)
    keys = [tuple(k) for k in keys]
    u1 = round(keys[-1][0] * 30) / 30
    if len(keys) > 1 and u1 <= keys[-2][0]:
        u1 = math.ceil(keys[-1][0] * 30) / 30
    keys[-1] = (u1, keys[-1][1])
    return keys


def tail(f, t0, keys):
    """(pass A4) The channel f as it is up to t0, then cubic keys [(t, value[, 'stop'])...] starting from f's value and
    slope at t0 (no jump in value or speed); the last key is passed at rest and held."""
    h = 1e-3
    v0, m0 = f(t0), (f(t0) - f(t0 - h)) / h
    k = Keys([(t0, v0 * 1)] + [(kk[0], Vector(kk[1]) if isinstance(kk[1], (tuple, list)) else kk[1]) + tuple(kk[2:]) for kk in keys])
    base = k._tangent
    k._tangent = lambda i: m0 * 1 if i == 0 else base(i)
    return lambda t: f(t) if t <= t0 else k(t)


def _frames(t0, t1, n):
    return max(0, int(round(t0 * FPS))), min(n - 1, int(round(t1 * FPS)))


def contacts_from_plans_impl(c, V):
    """Contacts from the plans: every hand hold on a vehicle node (kind from c.auto_contacts[(side, k)],
    default grip) and every foot plant (on a node, or on the ground: node None, kind ground / press)."""
    out = []
    n = c.n_out()
    _frames = c.frames_of
    for side in ('Left', 'Right'):
        s = SIDE[side]
        for k, step in enumerate(c.hands[side]):
            if step[0] != 'hold' or step[3] is None or str(step[3]).startswith('@'):
                continue
            a, b = _frames(step[1], step[2], n)
            if a > b:
                continue
            out.append({'part': 'hand_' + s, 'from': a, 'to': b, 'node': step[3], 'at': [round(x, 4) for x in step[4]],
                        'kind': c.auto_contacts.get((side, k), 'grip')})
        for k, step in enumerate(c.feet[side]):
            if step[0] != 'plant':
                continue
            a, b = _frames(step[1], step[2], n)
            if a > b:
                continue
            g = step[4]
            ball = sole_points(g, step[5], step[6])[1]
            # (pass A2: a foot arriving on a vehicle node is on its contact once within 1.2 cm of its place)
            if step[3] is not None and k == len(c.feet[side]) - 1 and side in getattr(c, 'contact_lead', ()):
                want = c.veh.world(step[3], {}) @ Vector(ball)
                while a > 0:
                    t = c.W((a - 1) / FPS)
                    gg, yy, pp = c.foot_at(side, t, c.controls(t))
                    if (sole_points(gg, yy, pp)[1] - want).length > c.contact_lead[side]:
                        break
                    a -= 1
            # (and a foot leaving one stays on it while within the same distance of its place)
            if step[3] is not None and k == 0 and side in getattr(c, 'contact_trail', ()):
                want = c.veh.world(step[3], {}) @ Vector(ball)
                while b < n - 1:
                    t = c.W((b + 1) / FPS)
                    gg, yy, pp = c.foot_at(side, t, c.controls(t))
                    if (sole_points(gg, yy, pp)[1] - want).length > c.contact_trail[side]:
                        break
                    b += 1
            out.append({'part': 'foot_' + s, 'from': a, 'to': b, 'node': step[3], 'at': [round(x, 4) for x in ball],
                        'kind': c.auto_contacts.get(('foot' + side, k), 'ground' if step[3] is None else 'press'), 'point': 'ball'})
    out.sort(key=lambda d: (d['from'], d['part']))
    return out


Clip.contacts_from_plans = lambda self, V: contacts_from_plans_impl(self, V)
