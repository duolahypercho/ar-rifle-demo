"""(pass A4) The athletic clips (VEHICLE_NOTES.md "Third request", "Clips"): getting out of a moving vehicle and
coming down. All authored by rule (keys and targets), no motion capture.

  car-bail    (car frame, ~0.6 s)  from car-drive frame 0: the left hand shoves the door open, the body turns and
                                   launches out of the doorway; ends airborne outside. events.release, door per frame
  bail-roll   (ground, ~1.8 s)     from car-bail's last pose: down onto the right shoulder and hip, a roll along the
                                   travel, up to a crouch, standing. events.ground, events.free; root travel ~2.5 m
  heli-jump   (helicopter frame, ~1.0 s) from heli-fly frame 0: hands off, the door pushed open, the body turns and
                                   jumps out of the doorway; ends airborne outside. events.release, door per frame
  fall        (ground, loop 1.0 s) airborne, limbs spread, a slow flail; its frame 0 is the shared airborne pose
  land-roll   (ground, ~1.3 s)     feet first from the fall pose, the knees take it, a forward roll, standing
  land-hard   (ground, ~2.5 s)     feet first, the knees buckle, down onto the hands and the right hip, a beat, up

Ground clips: the clip's own frame has its ground at y = 0, the travel along -Z (the clips' forward); the root
track [x, z, yaw] starts where the body starts. The limbs are given as keyed TARGETS (AClip): a hand or foot on
the body (in the pelvis's or the chest's own frame, turning with it: airborne, rolling), on the ground (planted:
a contact), or in the vehicle; between two keys the target moves from one to the other (minimum jerk), each
evaluated at the moment, so a limb leaving the body for the ground goes with the body until it is down.
"""
import json
import math
import os
import pathlib

from mathutils import Matrix, Quaternion, Vector

from rifle_motion.gait import ANKLE, FPS, foot as foot_of
from rifle_motion.handling import Keys, ease, min_jerk

from .pose import Clip, K, V3, hq, sole_points, wheel_grip

DEG = math.pi / 180
NAMES = ('car-bail', 'bail-roll', 'heli-jump', 'fall', 'land-roll', 'land-hard',
         'para-pickup', 'para-deploy', 'para-hang', 'para-steer-l', 'para-steer-r', 'para-flare', 'para-land')
GROUND_CLIPS = ('bail-roll', 'fall', 'land-roll', 'land-hard')
# joins measured (judge_a4.join_rel, relative to the pelvis): {clip: {label: (other clip, this clip's frame, the other's frame)}}
JOINS = {'para-deploy': {'fall frame 0': ('fall', 0, 0), 'para-hang frame 0': ('para-hang', -1, 0)},
         'para-land': {'para-hang frame 0': ('para-hang', 0, 0)}, 'para-steer-l': {'para-hang frame 0 but arm l': ('para-hang', 0, 0)},
         'para-steer-r': {'para-hang frame 0 but arm r': ('para-hang', 0, 0)}, 'para-flare': {'para-hang frame 0 but arm l, arm r': ('para-hang', 0, 0)},
         'fall': {'heli-jump end (0.2 s blend)': ('heli-jump', 0, -1), 'car-bail end (0.2 s blend)': ('car-bail', 0, -1)}, 'heli-jump': {}, 'car-bail': {}, 'bail-roll': {'car-bail end': ('car-bail', 0, -1)}, 'land-hard': {'fall frame 0': ('fall', 0, 0)}, 'land-roll': {'fall frame 0': ('fall', 0, 0)}}


class Ground:
    """The ground clips' 'vehicle': no nodes, its frame is the clip's own (ground y = 0)."""
    kind = 'ground'
    door_node = None

    def world(self, name, ctl=None):
        return Matrix.Identity(4)

    def moved(self, name, ctl):
        return Matrix.Identity(4)

    def to_local(self, name, p, ctl=None):
        return Vector(p)

    def point(self, name, at, ctl=None):
        return Vector(at)


def Rx(d):
    return Quaternion((1, 0, 0), d * DEG)


def Ry(d):
    return Quaternion((0, 1, 0), d * DEG)


def Rz(d):
    return Quaternion((0, 0, 1), d * DEG)


class AClip(Clip):
    """A clip whose hands and feet follow keyed targets: hand_keys / foot_keys {side: [(t, spec)]}.
    hand specs: ('chest' | 'pelvis' | 'body', palm, quat) in that frame of the body; ('V', palm, quat) fixed in the clip's
    frame (the ground, or the vehicle at rest); ('node', name, palm, quat) on a vehicle node (moving with the controls).
    foot specs: ('pelvis', ankle, quat) in the pelvis's frame; ('ground', ground point, yaw deg, pitch deg) planted (the
    standard foot: rolled about the heel / ball); ('node', name, ground point, yaw, pitch) planted on a vehicle node.
    A key may be (t, spec, lift): the move from the key before arcs `lift` m up at its middle."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.hand_keys = {'Left': [], 'Right': []}
        self.foot_keys = {'Left': [], 'Right': []}
        self.hands = {'Left': [], 'Right': []}
        self.feet = {'Left': [], 'Right': []}
        self.ground_fit = None  # per authored frame: dy added to the pelvis (ground_a4.json)

    @staticmethod
    def skel_ankle(f):
        """The ankle's offset above a planted foot's ground point (f: ground, yaw, pitch)."""
        return foot_of(Vector(f[0]), f[1] * DEG, f[2] * DEG)[0] - Vector(f[0])

    def roll_on_handles(self, V):
        """(no handles) A hand not on the ground or the vehicle turns with its forearm: its fingers continue the forearm
        (a straight wrist), the palm kept as near its authored way as that allows; blended in and out with the move
        to or from a planted place."""
        from rifle_motion.carry import PALM_LOCAL
        from rifle_motion.handling import two_bone
        from rifle_motion.skel import SIDE
        self._palm_local = PALM_LOCAL
        for side in ('Left', 'Right'):
            s = SIDE[side]
            upper = self.skel.rest['lowerarm_' + s].length
            fore = self.skel.rest['hand_' + s].length
            reach = 0.95 * (upper + fore + PALM_LOCAL.length)
            prev = None
            for v in V:
                palm, q = v['hands'][side]
                pos, rot = self.skel.fk(v['local'], v['hips'])
                sh = pos['upperarm_' + s]
                wrist = palm - q @ PALM_LOCAL
                if (wrist - sh).length > 0.97 * (upper + fore) and self._free_weight(side, v['t']) > 0:  # (never quite straight: the
                    # target pulled in towards the shoulder; a planted hand keeps its place, ground_hand put it in reach)
                    palm = palm + (sh + (wrist - sh).normalized() * 0.97 * (upper + fore) - wrist)
                    v['hands'][side] = (palm, q)
                w = self._free_weight(side, v['t'])
                if w <= 0:
                    prev = None
                    continue
                pole = v['poles'][0 if side == 'Left' else 1]
                q2 = prev if prev is not None else q  # (from the last frame's turn: no flip where the fingers run back along the forearm)
                for _ in range(3):
                    wrist = palm - q2 @ PALM_LOCAL
                    elbow = two_bone(sh, wrist, upper, fore, sh + rot['spine_05'] @ Vector(pole))
                    d = (wrist - elbow).normalized()
                    q2 = ((q2 @ Vector((0, -1, 0))).rotation_difference(d) @ q2).normalized()
                # (the turn about the forearm goes towards the authored one's, at most 15 deg a frame)
                qt = ((q @ Vector((0, -1, 0))).rotation_difference(d) @ q).normalized()
                r = (qt @ q2.inverted()).normalized()
                if r.w < 0:
                    r = -r
                tw = 2 * math.atan2(Vector((r.x, r.y, r.z)).dot(d), r.w)
                cap = math.radians(15) if prev is not None else math.pi
                q2 = (Quaternion(d, max(-cap, min(cap, tw))) @ q2).normalized()
                prev = q2
                q2 = (q2 @ Quaternion((1, 0, 0), getattr(self, 'wrist_flex', 0.0) * DEG)).normalized()
                if q.dot(q2) < 0:
                    q2 = -q2
                v['hands'][side] = (palm, q.slerp(q2, w).normalized())
        self.clamp_wrists(V)

    def clamp_wrists(self, V, flex_lim=55.0, dev_lim=30.0):
        from rifle_motion.carry import PALM_LOCAL
        """A hand on the ground (or anywhere) whose wrist would bend past the lines turns about its palm's middle: about
        its palm's normal (deviation) and its own across axis (flexion: the heel of the hand comes up off the ground),
        the least turn that brings it inside them."""
        bias = load_bias(self.name)  # (the measured angles of the last build against this estimate, per frame: wrist_a4.json)
        self.wrist_est = {'Left': [], 'Right': []}
        for side in ('Left', 'Right'):
            for i, v in enumerate(V):
                palm, q = v['hands'][side]
                pos, rot = self.skel.fk(v['local'], v['hips'])
                pole = Vector(v['poles'][0 if side == 'Left' else 1])
                f, d = self.wrist_angles(side, palm, q, pos, rot, pole)
                bf, bd = (bias.get(side) or {}).get(str(i), (0.0, 0.0))
                if abs(f + bf) <= flex_lim and abs(d + bd) <= dev_lim:
                    self.wrist_est[side].append([round(f, 2), round(d, 2)])
                    continue

                free = self._free_weight(side, v['t']) >= 0.5  # (a free hand turns about its wrist, a planted one about its palm)
                wrist0 = palm - q @ PALM_LOCAL

                def at(q2):
                    return wrist0 + q2 @ PALM_LOCAL if free else palm

                def cost(ab):
                    q2 = (q @ Quaternion((0, 0, 1), ab[1] * DEG) @ Quaternion((1, 0, 0), ab[0] * DEG)).normalized()
                    f2, d2 = self.wrist_angles(side, at(q2), q2, pos, rot, pole)
                    f2, d2 = f2 + bf, d2 + bd
                    return max(0.0, abs(f2) - flex_lim) ** 2 + max(0.0, abs(d2) - dev_lim) ** 2 + 0.002 * (ab[0] ** 2 + ab[1] ** 2)
                best = min(((a, b) for a in range(-90, 91, 6) for b in range(-72, 73, 6)), key=cost)
                for st in (3, 1):
                    best = min(((best[0] + da, best[1] + db) for da in (-st, 0, st) for db in (-st, 0, st)), key=cost)
                try:
                    import bpy
                    if bpy.app.driver_namespace.get('a4_debug') and i in bpy.app.driver_namespace['a4_debug']:
                        print('CLAMP', side, i, round(f, 1), round(d, 1), 'free', free, 'best', best, 'cost', round(cost(best), 1),
                              [(ab, round(cost(ab), 1)) for ab in ((0, 0), (0, 20), (0, -20), (20, 0), (-20, 0))])
                except ImportError:
                    pass
                q3 = (q @ Quaternion((0, 0, 1), best[1] * DEG) @ Quaternion((1, 0, 0), best[0] * DEG)).normalized()
                if getattr(self, 'clamp_smooth', False):  # (applied after, smoothed over the frames: no frame-to-frame jump)
                    self.__dict__.setdefault('_clamp', {}).setdefault(side, {})[i] = (best, free)
                    self.wrist_est[side].append([round(f, 2), round(d, 2)])
                    continue
                v['hands'][side] = (at(q3), q3)
                self.wrist_est[side].append([round(x, 2) for x in self.wrist_angles(side, at(q3), q3, pos, rot, pole)])
        if getattr(self, 'clamp_smooth', False):
            self._apply_smooth_clamp(V)
        if getattr(self.veh, 'kind', '') == 'ground':  # (a hand's fingertips kept out of the ground: the palm lifted, by one
            # amount over each stretch the hand is planted, so the palm does not creep on its place)
            for side in ('Left', 'Right'):
                lifts = []
                for v in V:
                    palm, q = v['hands'][side]
                    low = min((palm + q @ Vector(p)).y for p in ((0.0, -0.10, 0.0), (0.03, -0.09, 0.0), (-0.03, -0.085, 0.0), (0.0, -0.10, 0.02)))
                    lifts.append(max(0.0, 0.004 - low))
                planted = [self._free_weight(side, v['t']) <= 0.0 for v in V]
                i = 0
                while i < len(V):
                    if planted[i]:
                        j = i
                        while j + 1 < len(V) and planted[j + 1]:
                            j += 1
                        m = max(lifts[i:j + 1])
                        for k in range(i, j + 1):
                            lifts[k] = m
                        i = j + 1
                    else:
                        i += 1
                for v, lift in zip(V, lifts):
                    if lift > 0:
                        palm, q = v['hands'][side]
                        v['hands'][side] = (palm + Vector((0.0, lift, 0.0)), q)

    def make(self, carry, carry2):
        if self.contacts == 'planted':  # (after the warp is known: the plants' frames are the clip's own)
            self.contacts = self.planted_contacts()
        frames, meta, V, roots = super().make(carry, carry2)
        for c in meta['contacts']:  # (a hand on the ground: its point where the palm really is, its mean)
            if c['part'].startswith('hand') and c['node'] is None:
                side = 'Left' if c['part'] == 'hand_l' else 'Right'
                pts = [V[i]['hands'][side][0] for i in range(c['from'], min(c['to'], len(V) - 1) + 1)]
                if pts:
                    c['at'] = [round(x, 4) for x in sum(pts, Vector()) / len(pts)]
        return frames, meta, V, roots

    def _apply_smooth_clamp(self, V):
        from rifle_motion.carry import PALM_LOCAL
        from rifle_motion.gait import periodic_smooth
        n = len(V)
        for side, per in (self.__dict__.get('_clamp') or {}).items():
            a = [per.get(i, ((0.0, 0.0), True))[0][0] for i in range(n)]
            b = [per.get(i, ((0.0, 0.0), True))[0][1] for i in range(n)]
            # (the largest correction within 2 frames each side, then smoothed: the needed turn kept at its frame, eased in and out)
            def spread(x):
                m = [max((x[j] for j in range(max(0, i - 2), min(n, i + 3))), key=abs) for i in range(n)]
                return periodic_smooth(m, 1.5, self.loop)
            a, b = spread(a), spread(b)
            for i, v in enumerate(V):
                if abs(a[i]) < 1e-3 and abs(b[i]) < 1e-3:
                    continue
                palm, q = v['hands'][side]
                q3 = (q @ Quaternion((0, 0, 1), b[i] * DEG) @ Quaternion((1, 0, 0), a[i] * DEG)).normalized()
                if self._free_weight(side, v['t']) >= 0.5:
                    palm = palm - q @ PALM_LOCAL + q3 @ PALM_LOCAL
                v['hands'][side] = (palm, q3)

    def _free_weight(self, side, t):
        keys = self.hand_keys[side]
        planted = lambda sp: sp[0] in ('V', 'node')  # noqa: E731
        if len(keys) == 1:
            return 0.0 if planted(keys[0][1]) else 1.0
        i = self._span(keys, t)
        (t0, s0), (t1, s1) = keys[i][:2], keys[i + 1][:2]
        x = 0.0 if t <= t0 else 1.0 if t >= t1 else (t - t0) / (t1 - t0)
        a, b = (0.0 if planted(s0) else 1.0), (0.0 if planted(s1) else 1.0)
        if a < b:  # (off the ground the hand turns with its forearm at once; onto it, it turns for its place at the end)
            return ease(min(1.0, x / 0.45))
        if a > b:
            return 1.0 - ease(max(0.0, (x - 0.7) / 0.3))
        if a == 0.0 and s0 is not s1:  # (from one hold to another: free in the middle of the way)
            return math.sin(math.pi * x) ** 2
        return a

    def _body(self, frame, t):
        return self.node_frame('@' + frame, t, {})

    def _hand(self, spec, t, ctl):
        kind = spec[0]
        if kind in ('chest', 'pelvis', 'body'):
            m = self._body(kind, t)
            return m @ Vector(spec[1]), (m.to_quaternion() @ spec[2]).normalized()
        if kind == 'V':
            return Vector(spec[1]), Quaternion(spec[2])
        if kind == 'node':
            m = self.veh.world(spec[1], ctl)
            return m @ Vector(spec[2]), (m.to_quaternion() @ spec[3]).normalized()
        raise ValueError(spec)

    def _foot(self, spec, t, ctl):
        """(ankle, quat) in V, and the standard (ground, yaw, pitch) if the foot is planted."""
        kind = spec[0]
        if kind == 'pelvis':
            m = self._body('pelvis', t)
            q = (m.to_quaternion() @ spec[2]).normalized()
            return m @ Vector(spec[1]), q, None
        if kind == 'ground':
            g, yaw, pitch = Vector(spec[1]), spec[2], spec[3]
            ankle, q, _ = foot_of(g, yaw * DEG, pitch * DEG)
            return ankle, q, (g, yaw, pitch)
        if kind == 'node':
            m = self.veh.world(spec[1], ctl)
            g = m @ Vector(spec[2])
            ankle, q, _ = foot_of(g, spec[3] * DEG, spec[4] * DEG)
            return ankle, q, (g, spec[3], spec[4])
        if kind == 'V':  # (an ankle at a point of the clip's frame, turned whole: a foot on its way over a sill)
            return Vector(spec[1]), Quaternion(spec[2]), None
        raise ValueError(spec)

    @staticmethod
    def _span(keys, t):
        for i in range(len(keys) - 1):
            if keys[i][0] - 1e-9 <= t <= keys[i + 1][0] + 1e-9:
                return i
        return 0 if t < keys[0][0] else len(keys) - 2

    def _blend(self, keys, t, ev):
        if len(keys) == 1:
            return ev(keys[0][1]), None, True
        i = self._span(keys, t)
        (t0, s0), (t1, s1) = keys[i][:2], keys[i + 1][:2]
        lift = keys[i + 1][2] if len(keys[i + 1]) > 2 else 0.0
        if s0 is s1 or t <= t0:
            return ev(s0), (i, i), s0 is s1 or t <= t0
        if t >= t1:
            return ev(s1), (i + 1, i + 1), True
        x = (t - t0) / (t1 - t0)
        w = min_jerk(x)
        a, b = ev(s0), ev(s1)
        vias = keys[i + 1][3] if len(keys[i + 1]) > 3 else None
        if vias:  # (one move through points on the way: the position along the path, the turn as without)
            pts = [a[0]] + [Vector(v) for v in vias] + [b[0]]
            L = [0.0]
            for p_, q_ in zip(pts, pts[1:]):
                L.append(L[-1] + max(1e-4, (q_ - p_).length))
            path = Keys([(L[j] / L[-1], pts[j]) for j in range(len(pts))])
            pos = path(w)
            a = (pos,) + tuple(a[1:])
            b = (pos,) + tuple(b[1:])
        return (a, b, w, lift * math.sin(math.pi * x) ** 2), (i, i + 1), False

    def hand_at(self, side, t, ctl):
        r, _, still = self._blend(self.hand_keys[side], t, lambda s: self._hand(s, t, ctl))
        if still:
            return r
        (pa, qa), (pb, qb), w, lift = r
        if qa.dot(qb) < 0:
            qb = -qb
        return pa.lerp(pb, w) + Vector((0, lift, 0)), qa.slerp(qb, w).normalized()

    def foot_at(self, side, t, ctl):
        r, _, still = self._blend(self.foot_keys[side], t, lambda s: self._foot(s, t, ctl))
        if still:
            ankle, q, planted = r
            if planted is not None:
                return planted
            return (ankle - q @ ANKLE, 0.0, 0.0, q)
        (aa, qa, _), (ab, qb, _), w, lift = r
        if qa.dot(qb) < 0:
            qb = -qb
        ankle = aa.lerp(ab, w) + Vector((0, lift, 0))
        q = qa.slerp(qb, w).normalized()
        return (ankle - q @ ANKLE, 0.0, 0.0, q)

    def body_at(self, t):
        local, hips = super().body_at(t)
        if self.ground_fit:
            x = max(0.0, min(len(self.ground_fit) - 1.0, t * FPS))
            k = int(x)
            hips = hips + Vector((0.0, self.ground_fit[k] + (self.ground_fit[min(k + 1, len(self.ground_fit) - 1)] - self.ground_fit[k]) * (x - k), 0.0))
        return local, hips

    def planted_contacts(self):
        """Contacts from the keys: a part whose two keys in a row are the same 'ground' (feet) or 'V' (hands) spec is
        on the ground (node null) at its point from the first to the second."""
        out = []
        n = self.n_out()
        for side, s in (('Left', 'l'), ('Right', 'r')):
            for keys, part in ((self.foot_keys[side], 'foot_' + s), (self.hand_keys[side], 'hand_' + s)):
                i = 0
                while i < len(keys) - 1:
                    sp = keys[i][1]
                    j = i
                    while j + 1 < len(keys) and keys[j + 1][1] is sp:
                        j += 1
                    if j > i and sp[0] in ('ground', 'V', 'node'):
                        a, b = self.frames_of(keys[i][0], keys[j][0], n) if self.warp else (int(math.ceil(keys[i][0] * FPS - 1e-6)), min(n - 1, int(math.floor(keys[j][0] * FPS + 1e-6))))
                        if part.startswith('foot'):
                            if sp[0] == 'node':
                                at, node = sole_points(sp[2], sp[3], sp[4])[1], sp[1]
                            else:
                                at, node = sole_points(sp[1], sp[2], sp[3])[1], None
                            out.append({'part': part, 'from': a, 'to': b, 'node': node, 'at': [round(x, 4) for x in at], 'kind': 'ground' if node is None else 'step', 'point': 'ball'})
                        else:
                            node = sp[1] if sp[0] == 'node' else None
                            at = sp[2] if sp[0] == 'node' else sp[1]
                            out.append({'part': part, 'from': a, 'to': b, 'node': node, 'at': [round(x, 4) for x in at], 'kind': 'push'})
                    i = j + 1 if j > i else i + 1
        out.sort(key=lambda d: (d['from'], d['part']))
        return out


# ---------------------------------------------------------------- shared poses (Tripo's proportions; EarthOnline below)
ST = 0.915  # standing pelvis height (as car-exit's)
ST_LAND = 0.895  # standing at the end of a ground clip: the knees a little bent (the clip gate's knee line)
AIR = dict(  # the airborne pose (fall's frame 0; car-bail's and heli-jump's ends come to it), body frames
    turn_pitch=12.0, spine=V3(14.0, 0.0, 0.0), look=V3(0.0, 22.0), collar=V3(-6.0, 10.0, 6.0, 10.0),
    hand_l=V3(0.52, 0.02, 0.18), hand_r=V3(-0.52, 0.0, 0.20),
    qhand_l=hq((0.0, -1.0, 0.25), (1.0, 0.1, 0.25)), qhand_r=hq((0.0, -1.0, 0.25), (-1.0, 0.1, 0.25)),
    ankle_l=V3(0.14, -0.70, 0.12), ankle_r=V3(-0.13, -0.62, -0.10),
    qfoot_l=Ry(8.0) @ Rx(30.0), qfoot_r=Ry(-8.0) @ Rx(30.0),
    poles=(V3(0.4, -0.4, -0.8), V3(-0.4, -0.4, -0.8)), knees=(V3(0.15, 0.1, 1.0), V3(-0.15, 0.1, 1.0)),
    hips=1.1,  # the pelvis's height over the root in the ground clips' airborne frames
)
FIT = {}  # (per body; set by make() from BODY_FIT)
BODY_FIT = {'civilian-m-01-player-ue5': dict(st=0.88, dy=-0.035)}


def _body_name():
    from rifle_motion import body as body_table
    return body_table.T.get('name')


def hang_hand(side, forward=0.07, out=0.03, down=0.57):
    sx = 1 if side == 'Left' else -1
    return ('body_' + ('l' if side == 'Left' else 'r'), V3(sx * out, -down, forward), hq((-sx, 0, 0.1), (0, -1, 0.12)))


def _shoulder_spec(side, forward=0.07, out=0.03, down=0.57):
    """A hand hanging by the thigh (the pseudo-frame '@shoulder_l / r', as clips_car.hang)."""
    sx = 1 if side == 'Left' else -1
    return ('shoulder_' + ('l' if side == 'Left' else 'r'), V3(sx * out, -down, forward), hq((-sx, 0, 0.1), (0, -1, 0.12)))


def _extend_hand_kinds():
    """AClip._hand also takes 'shoulder_l' / 'shoulder_r' (the hanging hand's frame)."""
    base = AClip._hand

    def _hand(self, spec, t, ctl):
        if spec[0] in ('shoulder_l', 'shoulder_r'):
            m = self.node_frame('@' + spec[0], t, ctl)
            return m @ Vector(spec[1]), (m.to_quaternion() @ spec[2]).normalized()
        return base(self, spec, t, ctl)
    AClip._hand = _hand


_extend_hand_kinds()


def air_specs():
    """The airborne pose's limb targets (fresh spec objects)."""
    return {'hand': {'Left': ('chest', AIR['hand_l'], AIR['qhand_l']), 'Right': ('chest', AIR['hand_r'], AIR['qhand_r'])},
            'foot': {'Left': ('pelvis', AIR['ankle_l'], AIR['qfoot_l']), 'Right': ('pelvis', AIR['ankle_r'], AIR['qfoot_r'])}}


def body_knees(c, local_l, local_r, w=None):
    """Knee pole directions in V that turn with the pelvis."""
    def knees(t):
        q = c.node_frame('@pelvis', t, {}).to_quaternion()
        out = (q @ Vector(local_l(t) if callable(local_l) else local_l), q @ Vector(local_r(t) if callable(local_r) else local_r))
        return out if w is None else out + ((w(t) if callable(w) else w),)
    return knees


def load_bias(name):
    f = pathlib.Path(os.environ.get('A4_WRIST') or pathlib.Path(__file__).with_name('wrist_a4.json'))
    if not f.exists():
        return {}
    key = ('ue5:' if _body_name() == 'civilian-m-01-player-ue5' else '') + name
    return json.loads(f.read_text()).get(key, {})


def load_fit(name):
    f = pathlib.Path(os.environ.get('A4_GROUND') or pathlib.Path(__file__).with_name('ground_a4.json'))
    if not f.exists():
        return None
    key = ('ue5:' if _body_name() == 'civilian-m-01-player-ue5' else '') + name
    return json.loads(f.read_text()).get(key)


# ---------------------------------------------------------------- fall
def fall(c):
    """fall (loop 1.0 s): airborne, upright and a little forward, arms spread and windmilling slowly in turn, legs
    apart treading slowly, head down to the ground. Frame 0 is the shared airborne pose (AIR)."""
    T = 1.0
    w = 2 * math.pi / T
    h = AIR['hips'] + FIT.get('dy', 0.0)
    s, co = math.sin, math.cos

    def per(k, ph, t):
        return s(w * k * t + ph) - s(ph)
    c.pelvis = lambda t: V3(0.0, h + 0.015 * per(2, 0.0, t), 0.0)
    c.turn = lambda t: V3(180.0 + 3.0 * per(1, 0.5, t), AIR['turn_pitch'] + 2.0 * per(1, 1.3, t), 4.0 * per(1, 0.0, t))
    c.spine = lambda t: AIR['spine'] + V3(1.5 * per(2, 0.4, t), 6.0 * per(1, 0.0, t), -2.0 * per(1, 0.0, t))
    c.look = lambda t: AIR['look'] + Vector((8.0 * per(1, 0.9, t), 3.0 * per(2, 0.2, t)))
    c.collar = lambda t: AIR['collar'] + V3(0.0, 4.0 * per(1, 0.0, t), 0.0, -4.0 * per(1, 0.0, t))
    c.curl = lambda t: Vector((0.3 + 0.1 * per(1, 0.0, t), 0.3 - 0.1 * per(1, 0.0, t)))
    c.poles = lambda t: AIR['poles']
    c.knees = body_knees(c, AIR['knees'][0], AIR['knees'][1])
    c.root = lambda t: (0.0, 0.0, math.pi)

    class Live(tuple):  # (a target that moves with time: the flail, evaluated per frame)
        pass
    base_h = AIR['hand_l'], AIR['hand_r']
    c.hand_keys = {'Left': [(0.0, ('chest_fn', lambda t: base_h[0] + V3(0.0, 0.10 * per(1, 0.0, t), 0.08 * per(1, math.pi / 2, t)), AIR['qhand_l']))],
                   'Right': [(0.0, ('chest_fn', lambda t: base_h[1] + V3(0.0, -0.10 * per(1, 0.0, t), -0.08 * per(1, math.pi / 2, t)), AIR['qhand_r']))]}
    c.foot_keys = {'Left': [(0.0, ('pelvis_fn', lambda t: AIR['ankle_l'] + V3(0.0, 0.05 * per(1, 0.3, t), 0.08 * per(1, 0.3 + math.pi / 2, t)), AIR['qfoot_l']))],
                   'Right': [(0.0, ('pelvis_fn', lambda t: AIR['ankle_r'] + V3(0.0, -0.05 * per(1, 0.3, t), -0.08 * per(1, 0.3 + math.pi / 2, t)), AIR['qfoot_r']))]}
    c.ctl = {}
    c.contacts = []
    c.events = {}
    c.finger_pose = None


def _extend_fn_kinds():
    """'chest_fn' / 'pelvis_fn': like 'chest' / 'pelvis' with the point a function of time."""
    bh, bf = AClip._hand, AClip._foot

    def _hand(self, spec, t, ctl):
        if spec[0] == 'chest_fn':
            m = self._body('chest', t)
            return m @ spec[1](t), (m.to_quaternion() @ spec[2]).normalized()
        return bh(self, spec, t, ctl)

    def _foot(self, spec, t, ctl):
        if spec[0] == 'pelvis_fn':
            m = self._body('pelvis', t)
            return m @ spec[1](t), (m.to_quaternion() @ spec[2]).normalized(), None
        return bf(self, spec, t, ctl)
    AClip._hand, AClip._foot = _hand, _foot


_extend_fn_kinds()


def _stand_hands(c, t0, t1=None):
    """Both hands from where they are keyed at t0 to hanging by the thighs at t1 (shoulder frames)."""
    for side in ('Left', 'Right'):
        c.hand_keys[side].append((t1, _shoulder_spec(side)))


def ground_hand(c, side, point, t, aim=None):
    """A hand flat on the ground at `point` (V), its fingers pointing away from its shoulder as the body is at t (no
    sideways bend at the wrist), palm down."""
    from rifle_motion.skel import SIDE
    reach = 0.9 * (c.skel.rest['lowerarm_' + SIDE[side]].length + c.skel.rest['hand_' + SIDE[side]].length + 0.08)
    point = Vector(point)
    sh0 = None
    ts = (t if isinstance(t, (tuple, list)) else (t,))
    if len(ts) == 2:  # (a hold: every frame of it)
        ts = [ts[0] + k / 30.0 for k in range(int((ts[1] - ts[0]) * 30) + 1)]
    for tt in ts:
        local, hips = c.body_at(tt)
        pos, _ = c.skel.fk(local, hips)
        sh = pos['upperarm_' + SIDE[side]]
        sh0 = sh0 or sh
        if (point - sh).length > reach:  # (in reach of the arm as the body is then: pulled in towards the shoulder, on the ground)
            hz = math.sqrt(max(0.0, reach ** 2 - (sh.y - point.y) ** 2))
            dd = point - sh
            dd.y = 0.0
            point = Vector((sh.x, point.y, sh.z)) + dd.normalized() * hz
    if aim is not None:
        local, hips = c.body_at(aim)
        sh0 = c.skel.fk(local, hips)[0]['upperarm_' + SIDE[side]]
    sh = sh0
    d = point - sh
    d.y = 0.0
    return ('V', point, hq((0.0, -1.0, 0.0), d.normalized()))


def land_hard(c):
    """land-hard (2.5 s): feet first from the fall pose (contact at 0.067 s), the knees buckle into a deep squat, the body
    tips back and to the right onto the right hip, the right hand back on the ground behind it, the left hand down beside
    the left foot; a beat with the head down; then forward onto the feet (the hands push off) and up, slowly; standing
    from 2.35 (free)."""
    st = ST_LAND + FIT.get('dy', 0.0)
    h0 = AIR['hips'] + FIT.get('dy', 0.0)
    g0 = 4.0 / 30.0
    P = lambda *k: K(list(k))  # noqa: E731
    c.pelvis = P((0.0, (0.0, h0, 0.0)), (g0, (0.0, h0 - 0.24, -0.01)), (0.25, (0.0, 0.50, 0.04)), (0.42, (0.06, 0.30, 0.14)),
                 (0.6, (0.11, 0.17, 0.22)), (0.75, (0.12, 0.16, 0.23), 'stop'), (1.05, (0.12, 0.165, 0.23)), (1.35, (0.11, 0.17, 0.22), 'stop'),
                 (1.55, (0.07, 0.28, 0.12)), (1.75, (0.02, 0.45, 0.03)), (2.0, (0.0, 0.62, 0.01)), (2.3, (0.0, st, 0.0), 'stop'), (2.5, (0.0, st, 0.0), 'stop'))
    c.turn = P((0.0, (180.0, AIR['turn_pitch'], 0.0)), (g0, (180.0, 14.0, 0.0)), (0.25, (180.0, 30.0, 0.0)), (0.42, (176.0, 6.0, 10.0)),
               (0.6, (172.0, -16.0, 18.0)), (0.75, (172.0, -18.0, 16.0), 'stop'), (1.35, (173.0, -14.0, 14.0), 'stop'), (1.55, (176.0, 18.0, 8.0)),
               (1.75, (180.0, 35.0, 0.0)), (2.0, (180.0, 26.0, 0.0)), (2.3, (180.0, 0.0, 0.0), 'stop'), (2.5, (180.0, 0.0, 0.0), 'stop'))
    c.spine = P((0.0, tuple(AIR['spine'])), (0.25, (24.0, 0.0, 0.0)), (0.42, (26.0, -6.0, -4.0)), (0.6, (30.0, -10.0, -8.0)),
                (0.75, (32.0, -8.0, -8.0), 'stop'), (1.35, (34.0, -6.0, -6.0), 'stop'), (1.6, (26.0, 0.0, 0.0)), (2.0, (16.0, 0.0, 0.0)),
                (2.35, (2.0, 0.0, 0.0), 'stop'), (2.5, (2.0, 0.0, 0.0), 'stop'))
    c.look = P((0.0, tuple(AIR['look'])), (0.25, (0.0, 30.0)), (0.6, (10.0, 30.0)), (0.8, (8.0, 40.0)), (1.2, (4.0, 42.0)), (1.45, (0.0, 30.0)),
               (2.0, (0.0, 15.0)), (2.4, (0.0, 8.0), 'stop'), (2.5, (0.0, 8.0), 'stop'))
    c.collar = P((0.0, tuple(AIR['collar'])), (0.3, (0.0, 0.0, 0.0, 0.0)), (0.6, (-4.0, 6.0, 6.0, 10.0)), (1.35, (-4.0, 6.0, 6.0, 10.0), 'stop'),
                 (1.7, (0.0, 0.0, 0.0, 0.0)), (2.5, (0.0, 0.0, 0.0, 0.0), 'stop'))
    c.curl = P((0.0, (0.3, 0.3)), (0.3, (0.2, 0.2)), (2.0, (0.2, 0.2)), (2.4, (0.25, 0.25), 'stop'))
    pl0, pr0 = AIR['poles']
    c.poles = lambda t: (Vector(pl0).lerp(V3(0.6, -0.4, -0.7), ease((t - 0.1) / 0.3)).lerp(V3(0.7, -0.8, -0.2), ease((t - 1.5) / 0.6)),
                         Vector(pr0).lerp(V3(-0.6, -0.3, -0.7), ease((t - 0.1) / 0.3)).lerp(V3(-0.7, -0.8, -0.2), ease((t - 1.5) / 0.6)))
    c.knees = body_knees(c, lambda t: Vector(AIR['knees'][0]).lerp(V3(0.35, 0.2, 1.0), ease((t - 0.1) / 0.4)).lerp(V3(0.1, 0.0, 1.0), ease((t - 1.6) / 0.6)),
                         lambda t: Vector(AIR['knees'][1]).lerp(V3(-0.35, 0.2, 1.0), ease((t - 0.1) / 0.4)).lerp(V3(-0.1, 0.0, 1.0), ease((t - 1.6) / 0.6)))
    c.root = lambda t: (0.0, 0.0, math.pi)
    a = air_specs()
    fl = ('ground', V3(-0.14, 0.0, -0.06), 186.0, 0.0)
    fr = ('ground', V3(0.13, 0.0, 0.08), 174.0, 0.0)
    c.foot_keys = {'Left': [(0.0, a['foot']['Left']), (g0, fl), (2.5, fl)], 'Right': [(0.0, a['foot']['Right']), (g0, fr), (2.5, fr)]}
    hr = ground_hand(c, 'Right', V3(0.28, 0.025, 0.35), (0.55, 1.25), aim=0.9)
    knee_l = ('pelvis', V3(0.17, 0.30, 0.36), hq((0.0, -1.0, 0.2), (0.0, -0.2, 1.0)))
    c.hand_keys = {'Left': [(0.0, a['hand']['Left']), (0.2, ('chest', V3(0.30, -0.25, 0.30), AIR['qhand_l'])), (0.62, knee_l), (1.3, knee_l), (1.85, _shoulder_spec('Left'))],
                   'Right': [(0.0, a['hand']['Right']), (0.18, ('chest', V3(-0.38, -0.20, 0.0), AIR['qhand_r'])), (0.55, hr), (1.25, hr), (1.8, _shoulder_spec('Right'))]}
    c.ctl = {}
    c.events = {'ground': round(g0, 4), 'free': 2.35}
    c.roll = ((g0, 2.0),)
    c.support = ((0.62, 1.32),)  # (the trunk on the ground: the ground fit's window)
    c.contacts = 'planted'


def land_roll(c):
    """land-roll (1.6 s): feet first from the fall pose (contact 0.067 s), the knees take it into a squat leaning forward,
    the hands reach to the ground ahead (0.36) and give (0.44), the head tucks, the hips go up and over: a forward roll
    across the shoulders and the back (0.40-1.12) onto the feet in a crouch, standing by 1.55 (free), 1.4 m on."""
    st = ST_LAND + FIT.get('dy', 0.0)
    h0 = AIR['hips'] + FIT.get('dy', 0.0)
    g0 = 4.0 / 30.0
    D = 1.40  # how far the roll carries the body
    P = lambda *k: K(list(k))  # noqa: E731
    c.pelvis = P((0.0, (0.0, h0, 0.0)), (g0, (0.0, h0 - 0.24, -0.03)), (0.24, (0.0, 0.52, -0.12)), (0.36, (0.0, 0.50, -0.24)),
                 (0.50, (0.0, 0.48, -0.48)), (0.64, (0.0, 0.42, -0.76)), (0.78, (0.0, 0.30, -1.00)), (0.92, (0.0, 0.28, -1.18)),
                 (1.06, (0.0, 0.40, -D + 0.06)), (1.22, (0.0, 0.58, -D)), (1.55, (0.0, st, -D), 'stop'), (1.6, (0.0, st, -D), 'stop'))
    c.turn = P((0.0, (180.0, AIR['turn_pitch'], 0.0)), (g0, (180.0, 16.0, 0.0)), (0.24, (180.0, 38.0, 0.0)), (0.36, (180.0, 62.0, 0.0)),
               (0.50, (180.0, 112.0, 0.0)), (0.64, (180.0, 172.0, 0.0)), (0.78, (180.0, 240.0, 0.0)), (0.92, (180.0, 308.0, 0.0)),
               (1.06, (180.0, 372.0, 0.0)), (1.22, (180.0, 388.0, 0.0)), (1.55, (180.0, 360.0, 0.0), 'stop'), (1.6, (180.0, 360.0, 0.0), 'stop'))
    c.spine = P((0.0, tuple(AIR['spine'])), (0.24, (24.0, 0.0, 0.0)), (0.36, (45.0, 0.0, 0.0)), (0.50, (68.0, 0.0, 0.0)), (0.92, (66.0, 0.0, 0.0)),
                (1.06, (42.0, 0.0, 0.0)), (1.22, (26.0, 0.0, 0.0)), (1.55, (2.0, 0.0, 0.0), 'stop'), (1.6, (2.0, 0.0, 0.0), 'stop'))
    # (the head goes with the body through the roll, the chin on the chest: its pitch is the pelvis's and the spine's
    # bend plus the tuck; `look` is the head's turn in the clip's frame)
    tuck = P((0.0, AIR['look'][1] - AIR['turn_pitch'] - AIR['spine'][0]), (0.24, 0.0), (0.40, 30.0), (0.95, 30.0), (1.2, 0.0), (1.55, 6.0), (1.6, 6.0))
    c.look = lambda t: Vector((0.0, c.turn(t)[1] + c.spine(t)[0] + tuck(t)))
    c.collar = P((0.0, tuple(AIR['collar'])), (0.3, (-6.0, 6.0, 6.0, 6.0)), (1.0, (-6.0, 6.0, 6.0, 6.0)), (1.45, (0.0, 0.0, 0.0, 0.0), 'stop'), (1.6, (0.0, 0.0, 0.0, 0.0), 'stop'))
    c.curl = P((0.0, (0.3, 0.3)), (0.3, (0.15, 0.15)), (0.55, (0.6, 0.6)), (1.0, (0.6, 0.6)), (1.45, (0.25, 0.25), 'stop'))
    pl0, pr0 = AIR['poles']
    c.poles = lambda t: (Vector(pl0).lerp(V3(0.6, -0.3, -0.7), ease((t - 0.1) / 0.25)).lerp(V3(0.7, -0.8, -0.2), ease((t - 1.15) / 0.3)),
                         Vector(pr0).lerp(V3(-0.6, -0.3, -0.7), ease((t - 0.1) / 0.25)).lerp(V3(-0.7, -0.8, -0.2), ease((t - 1.15) / 0.3)))
    c.knees = body_knees(c, V3(0.15, 0.3, 1.0), V3(-0.15, 0.3, 1.0))
    zr = Keys([(0.0, 0.0), (0.3, -0.15), (1.1, -D + 0.05), (1.5, -D)])
    c.root = lambda t: (0.0, zr(t), math.pi)
    a = air_specs()
    fl0 = ('ground', V3(-0.14, 0.0, -0.08), 184.0, 0.0)
    fr0 = ('ground', V3(0.13, 0.0, 0.06), 176.0, 0.0)
    tuck_l = ('pelvis', V3(0.11, -0.26, 0.16), Rx(40.0))
    tuck_r = ('pelvis', V3(-0.11, -0.26, 0.16), Rx(40.0))
    fl1 = ('ground', V3(-0.12, 0.0, -D + 0.10), 182.0, 0.0)
    fr1 = ('ground', V3(0.13, 0.0, -D + 0.04), 178.0, 0.0)
    c.foot_keys = {'Left': [(0.0, a['foot']['Left']), (g0, fl0), (0.44, fl0), (0.62, tuck_l), (0.84, tuck_l), (0.98, fl1), (1.6, fl1)],
                   'Right': [(0.0, a['foot']['Right']), (g0, fr0), (0.44, fr0), (0.62, tuck_r), (0.84, tuck_r), (0.96, fr1), (1.6, fr1)]}
    hl = ground_hand(c, 'Left', V3(-0.21, 0.025, -0.72), (0.34, 0.40))
    hr = ground_hand(c, 'Right', V3(0.21, 0.025, -0.70), (0.34, 0.40))
    shin_l = ('pelvis', V3(0.16, 0.10, 0.42), hq((-1.0, 0.0, 0.0), (0.0, -0.3, 1.0)))
    shin_r = ('pelvis', V3(-0.16, 0.10, 0.42), hq((1.0, 0.0, 0.0), (0.0, -0.3, 1.0)))
    c.hand_keys = {'Left': [(0.0, a['hand']['Left']), (0.34, hl), (0.41, hl), (0.66, shin_l), (0.98, shin_l), (1.42, _shoulder_spec('Left'))],
                   'Right': [(0.0, a['hand']['Right']), (0.34, hr), (0.41, hr), (0.66, shin_r), (0.98, shin_r), (1.42, _shoulder_spec('Right'))]}
    c.ctl = {}
    c.events = {'ground': round(g0, 4), 'free': 1.55}
    c.roll = ((0.36, 1.12),)
    c.support = ((0.50, 1.04),)
    c.contacts = 'planted'


def car_bail(c):
    """car-bail (0.7 s, the car's frame), from car-drive frame 0: the left hand off the rim onto the door's inside and shoves
    it (0.10-0.22; the door flies up, open by 0.36); the right hand off the rim; the body turns left on the seat and sits up,
    the left leg out over the sill (0.12-0.40), the hips slide to the sill and the body launches out of the doorway under
    the door's rear edge, head and shoulders low, the right leg out from under the rim last (0.25-0.58); airborne outside,
    in the airborne pose (AIR), from 0.60 (release: the trailing foot over the sill's outer edge). Authored times; the
    clip plays them through a slower-only speed warp (warps_a4.json)."""
    from . import clips_car as cc
    veh = c.veh
    S = cc._seated_s()
    end = c.seconds
    P = lambda *k: K(list(k))  # noqa: E731
    seat = cc.seat_root(veh)
    yaw1 = A4B['yaw1']
    p1 = A4B['p1']
    c.pelvis = P((0.0, tuple(S['pelvis']), 'stop'), (0.08, tuple(S['pelvis'])), (0.22, (-0.45, 0.38, -0.19)), (0.36, (-0.66, 0.48, -0.10)),
                 (0.50, (-0.96, 0.66, 0.06)), (0.62, tuple(p1)), (end, tuple(p1 + V3(-0.08, 0.02, 0.01))))
    c.turn = P((0.0, tuple(S['turn']), 'stop'), (0.08, tuple(S['turn'])), (0.22, (194.0, -39.0, -8.0)), (0.36, (224.0, 0.0, -10.0)),
               (0.50, (yaw1 - 4.0, 24.0, -6.0)), (0.62, (yaw1, AIR['turn_pitch'], 0.0)), (end, (yaw1, AIR['turn_pitch'], 0.0), 'stop'))
    c.spine = P((0.0, tuple(S['spine']), 'stop'), (0.08, tuple(S['spine'])), (0.22, (16.0, 8.0, -20.0)), (0.36, (30.0, 6.0, -20.0)),
                (0.50, (26.0, 0.0, -8.0)), (0.62, tuple(AIR['spine'])), (end, tuple(AIR['spine']), 'stop'))
    c.look = P((0.0, tuple(S['look']), 'stop'), (0.1, (35.0, 15.0)), (0.3, (25.0, 25.0)), (0.5, (0.0, 30.0)), (end, tuple(AIR['look']), 'stop'))
    c.collar = P((0.0, tuple(S['collar']), 'stop'), (0.2, (-6.0, 10.0, 8.0, 10.0)), (0.5, tuple(AIR['collar'])), (end, tuple(AIR['collar']), 'stop'))
    c.curl = P((0.0, (1.0, 1.0), 'stop'), (0.06, (1.0, 1.0)), (0.14, (0.15, 0.3)), (0.3, (0.2, 0.3)), (end, (0.3, 0.3), 'stop'))
    c.finger_pose = cc.wheel_grip(c.author.fingers)
    pl0, pr0 = S['poles']
    c.poles = lambda t: (Vector(pl0).lerp(V3(0.3, -1.0, 0.2), ease(t / 0.12)).lerp(Vector(AIR['poles'][0]), ease((t - 0.25) / 0.3)),
                         Vector(pr0).lerp(V3(-0.7, -0.8, -0.2), ease((t - 0.05) / 0.15)).lerp(Vector(AIR['poles'][1]), ease((t - 0.3) / 0.3)))
    kl0, kr0 = S.get('knees') or (V3(0.0, 1.0, 0.0), V3(0.0, 1.0, 0.0))  # (a body whose seated pose has no knee poles: the rig's own, weight 0)
    wl0, wr0 = S.get('knees_w') or ((0.0, 0.0) if not S.get('knees') else (1.0, 1.0))
    body_k = body_knees(c, AIR['knees'][0], AIR['knees'][1])

    def knees(t):
        e = ease((t - 0.1) / 0.4)
        bl, br = body_k(t)
        up = math.sin(math.pi * min(1.0, max(0.0, (t - 0.1) / 0.36))) ** 2  # (the left knee up over the sill, the right one too after it)
        upr = math.sin(math.pi * min(1.0, max(0.0, (t - 0.25) / 0.36))) ** 2
        kl = Vector(kl0).lerp(bl, e).lerp(V3(*A4B['knee_up_l_ue5']) if _body_name() == 'civilian-m-01-player-ue5' else V3(-0.3, 1.0, -0.2), up)
        kr = Vector(kr0).lerp(br, e).lerp(V3(-0.3, 1.0, -0.2), upr)
        return (kl, kr, (max(wl0 + (1.0 - wl0) * e, up), max(wr0 + (1.0 - wr0) * e, upr)))
    c.knees = knees
    c.ctl = {'door': K([(0.0, 0.0), (0.12, 0.0, 'stop'), (0.20, 0.6), (0.30, 1.0, 'stop'), (end, 1.0, 'stop')]), 'wheel': 0.0}
    grip_l, grip_r = cc.rim_grip(270, 'Left'), cc.rim_grip(90, 'Right')
    # (the back of the left hand shoves the door: the hand keeps the turn it had on the rim, no turn of the forearm)
    din = cc._door_pt(veh, cc.DOOR_IN + V3(0.035, 0.02, 0.0))
    in_q = cc._door_q(veh, hq((1.0, 0.0, 0.0), (0.0, 0.5, -0.85)))
    a = air_specs()
    rim_l = ('node', 'steering_wheel', grip_l[0], grip_l[1])
    rim_r = ('node', 'steering_wheel', grip_r[0], grip_r[1])
    door = ('node', 'door_L', din, in_q)
    c.hand_keys = {'Left': [(0.0, rim_l), (0.02, rim_l), (0.13, door), (0.17, door), (0.40, ('chest', V3(0.32, -0.10, 0.28), AIR['qhand_l'])), (0.66, a['hand']['Left'])],
                   'Right': [(0.0, rim_r), (0.07, rim_r), (0.3, ('chest', V3(-0.18, -0.38, 0.16), AIR['qhand_r'])), (0.5, ('chest', V3(-0.25, -0.34, 0.16), AIR['qhand_r'])),
                             (0.7, ('chest', A4B['hand_r1'], AIR['qhand_r']))]}
    fl = (cc.ground_for_ball(S['ball_l'][0], S['ball_l'][1], S['ball_l'][2]), S['ball_l'][1], S['ball_l'][2])
    fr = (cc.ground_for_ball(S['ball_r'][0], S['ball_r'][1], S['ball_r'][2]), S['ball_r'][1], S['ball_r'][2])
    gl, gr = ('ground', fl[0], fl[1], fl[2]), ('ground', fr[0], fr[1], fr[2])
    sill_l = ('V', A4B['sill_l'], Ry(250.0) @ Rx(20.0))
    out_l = ('V', A4B['out_l'], Ry(232.0) @ Rx(15.0))
    under_r = ('V', A4B['under_r'], Ry(220.0) @ Rx(20.0))
    sill_r = ('V', A4B['sill_r'], Ry(245.0) @ Rx(25.0))
    up_l = ('V', fl[0] + c.skel_ankle(fl) + V3(0.03, 0.16, 0.05), Ry(fl[1]) @ Rx(-10.0))  # (straight up off the floor first)
    up0 = fl[0] + c.skel_ankle(fl) + V3(0.0, 0.07, 0.0)
    # (the left foot's way out of the footwell as car-exit's: back along the floor from under the dash, up and over the sill)
    way_l = A4B['way_l_ue5'] if _body_name() == 'civilian-m-01-player-ue5' else A4B['way_l']
    c.foot_keys = {'Left': [(0.0, gl), (0.08, gl), (0.42, out_l, 0.0, [V3(*v) for v in way_l]), (0.64, a['foot']['Left'])],
                   'Right': [(0.0, gr), (0.2, gr), (0.50, sill_r, 0.0, [A4B['under_r']]), (0.64, a['foot']['Right'])]}
    c.root0 = seat
    c.root1 = (p1.x - 0.08, p1.z + 0.01, math.radians(yaw1))
    c.root = None
    c.events = {'doorOpenStart': 0.12, 'doorOpenEnd': 0.30, 'release': 0.60, 'handsOff': 0.04, 'unseated': 0.3}
    c.contacts = 'planted'


def bail_roll(c):
    """bail-roll (1.8 s, ground frame; the travel along -Z, the car's forward at the release), from car-bail's last pose
    (airborne, facing 250 deg, out of the doorway): in the air the body turns towards the travel, dives and tucks, the
    arms in, the right shoulder meets the ground (0.30, events.ground) and the back takes the roll across to the left hip
    (0.30-0.85), the feet come down (0.84), up through a crouch with a step forward (1.1-1.55), standing (free 1.8);
    about 2.4 m along the travel. Authored times; a slower-only speed warp may stretch them (warps_a4.json)."""
    st = ST_LAND + FIT.get('dy', 0.0)
    yaw0 = A4B['yaw1']
    p0 = A4B['p1'] + V3(-0.08, 0.02, 0.01)
    h0 = p0.y
    g0 = 0.30
    D = 1.80  # (the roll's travel; the step after it adds the rest)
    P = lambda *k: K(list(k))  # noqa: E731
    c.pelvis = P((0.0, (0.0, h0, 0.0)), (0.15, (0.0, h0 - 0.12, -0.28)), (g0, (0.02, 0.48, -0.60)), (0.42, (0.02, 0.46, -0.86)),
                 (0.54, (0.0, 0.40, -1.12)), (0.66, (-0.02, 0.30, -1.36)), (0.78, (-0.02, 0.28, -1.58)), (0.92, (0.0, 0.42, -D + 0.04)),
                 (1.08, (0.0, 0.58, -D - 0.12)), (1.3, (0.0, 0.70, -D - 0.40)), (1.55, (0.0, st, -D - 0.58), 'stop'), (1.9, (0.0, st, -D - 0.58), 'stop'))
    c.turn = P((0.0, (yaw0, AIR['turn_pitch'], 0.0)), (0.15, (232.0, 30.0, 12.0)), (g0, (212.0, 70.0, 26.0)), (0.42, (200.0, 130.0, 28.0)),
               (0.54, (194.0, 190.0, 18.0)), (0.66, (190.0, 250.0, 0.0)), (0.78, (186.0, 305.0, -8.0)), (0.92, (182.0, 370.0, -4.0)),
               (1.08, (180.0, 385.0, 0.0)), (1.3, (180.0, 375.0, 0.0)), (1.55, (180.0, 360.0, 0.0), 'stop'), (1.9, (180.0, 360.0, 0.0), 'stop'))
    c.spine = P((0.0, tuple(AIR['spine'])), (0.15, (30.0, 0.0, 8.0)), (g0, (48.0, 6.0, 12.0)), (0.42, (66.0, 6.0, 8.0)), (0.78, (64.0, 0.0, 0.0)),
                (0.92, (44.0, 0.0, 0.0)), (1.08, (30.0, 0.0, 0.0)), (1.3, (18.0, 0.0, 0.0)), (1.6, (2.0, 0.0, 0.0), 'stop'), (1.9, (2.0, 0.0, 0.0), 'stop'))
    tuck = P((0.0, AIR['look'][1] - AIR['turn_pitch'] - AIR['spine'][0]), (0.15, 10.0), (g0, 30.0), (0.85, 30.0), (1.08, 0.0), (1.6, 6.0), (1.9, 6.0))
    c.look = lambda t: Vector((0.0, c.turn(t)[1] + c.spine(t)[0] + tuck(t)))
    c.collar = P((0.0, tuple(AIR['collar'])), (0.3, (-6.0, 6.0, 6.0, 6.0)), (0.9, (-6.0, 6.0, 6.0, 6.0)), (1.4, (0.0, 0.0, 0.0, 0.0), 'stop'), (1.9, (0.0, 0.0, 0.0, 0.0), 'stop'))
    c.curl = P((0.0, (0.3, 0.3)), (0.28, (0.15, 0.15)), (0.5, (0.6, 0.6)), (0.95, (0.6, 0.6)), (1.4, (0.25, 0.25), 'stop'))
    pl0, pr0 = AIR['poles']
    c.poles = lambda t: (Vector(pl0).lerp(V3(0.6, -0.3, -0.7), ease((t - 0.05) / 0.25)).lerp(V3(0.7, -0.8, -0.2), ease((t - 1.05) / 0.3)),
                         Vector(pr0).lerp(V3(-0.6, -0.3, -0.7), ease((t - 0.05) / 0.25)).lerp(V3(-0.7, -0.8, -0.2), ease((t - 1.05) / 0.3)))
    c.knees = body_knees(c, lambda t: Vector(AIR['knees'][0]).lerp(V3(0.15, 0.3, 1.0), ease(t / 0.25)), lambda t: Vector(AIR['knees'][1]).lerp(V3(-0.15, 0.3, 1.0), ease(t / 0.25)))
    zr = Keys([(0.0, 0.0), (0.3, -0.55), (0.9, -D + 0.05), (1.55, -D - 0.58)])
    yr = Keys([(0.0, yaw0), (0.4, 205.0), (0.9, 182.0), (1.3, 180.0)])
    c.root = lambda t: (0.0, zr(t), math.radians(yr(t)))
    a = air_specs()
    hand_r0 = ('chest', A4B['hand_r1'], AIR['qhand_r'])
    shin_l = ('pelvis', V3(0.16, 0.10, 0.42), hq((-1.0, 0.0, 0.0), (0.0, -0.3, 1.0)))
    shin_r = ('pelvis', V3(-0.16, 0.10, 0.42), hq((1.0, 0.0, 0.0), (0.0, -0.3, 1.0)))
    c.hand_keys = {'Left': [(0.0, a['hand']['Left']), (0.3, ('chest', V3(0.25, -0.10, 0.35), AIR['qhand_l'])), (0.56, shin_l), (0.9, shin_l), (1.4, _shoulder_spec('Left'))],
                   'Right': [(0.0, hand_r0), (g0 - 0.04, ('chest', V3(-0.20, -0.30, 0.40), AIR['qhand_r'])), (0.56, shin_r), (0.9, shin_r), (1.4, _shoulder_spec('Right'))]}
    tuck_l = ('pelvis', V3(0.11, -0.26, 0.16), Rx(40.0))
    tuck_r = ('pelvis', V3(-0.11, -0.26, 0.16), Rx(40.0))
    fl1 = ('ground', V3(-0.12, 0.0, -D + 0.10), 182.0, 0.0)
    fr1 = ('ground', V3(0.13, 0.0, -D + 0.02), 178.0, 0.0)
    fl2 = ('ground', V3(-0.12, 0.0, -D - 0.62), 180.0, 0.0)
    fr2 = ('ground', V3(0.13, 0.0, -D - 0.52), 178.0, 0.0)
    c.foot_keys = {'Left': [(0.0, a['foot']['Left']), (0.2, tuck_l), (0.70, tuck_l), (0.86, fl1), (1.18, fl1), (1.42, fl2, 0.08), (1.9, fl2)],
                   'Right': [(0.0, a['foot']['Right']), (0.2, tuck_r), (0.70, tuck_r), (0.84, fr1), (1.32, fr1), (1.52, fr2, 0.06), (1.9, fr2)]}
    c.ctl = {}
    c.events = {'ground': g0, 'free': 1.8}
    c.roll = ((g0, 1.0),)
    c.support = ((0.40, 0.90),)
    c.contacts = 'planted'


def heli_jump(c):
    """heli-jump (1.0 s, the helicopter's frame), from heli-fly frame 0 (in flight, the collective raised): hands off the
    controls, the right hand onto the door's glass and shoves it open (0.10-0.26; it swings full open by 0.45); the body
    turns right on the seat, the right foot off its pedal onto the doorway's step (0.12-0.42), the left leg swung up over
    the cyclic's grip and out (0.15-0.62); a push off the step and out of the doorway (0.45-0.78); airborne outside, in the
    airborne pose (AIR), facing out (yaw 95), from 0.80 (release). Authored times; a slower-only speed warp may stretch
    them (warps_a4.json)."""
    from . import clips_heli as ch
    _a4h_ns()
    veh = c.veh
    ref = ch.make('heli-seated', veh, c.author)
    ref.n = 1
    _, _, V0, _ = ref.make(c.author.carry, c.author.carry)
    v0 = V0[0]
    ctl0 = dict(ref.ctl)
    S = ch._fit()
    end = c.seconds
    P = lambda *k: K(list(k))  # noqa: E731
    yaw1 = A4H['yaw1']
    p1 = A4H['p1']
    pe = ref.pelvis(0.0)
    c.pelvis = P((0.0, tuple(pe), 'stop'), (0.08, tuple(pe)), (0.25, tuple(A4H['p25'])), (0.42, (0.64, 1.36, -1.36)),
                 (0.60, (0.90, 1.38, -1.38)), (0.80, tuple(p1)), (end, tuple(p1 + V3(0.10, -0.03, 0.0))))
    c.turn = P((0.0, tuple(ref.turn(0.0)), 'stop'), (0.08, tuple(ref.turn(0.0))), (0.25, (A4H['y25'], 2.0, 4.0)), (0.42, (128.0, 10.0, 0.0)),
               (0.60, (108.0, 22.0, 0.0)), (0.80, (yaw1, AIR['turn_pitch'], 0.0)), (end, (yaw1, AIR['turn_pitch'], 0.0), 'stop'))
    c.spine = P((0.0, tuple(ref.spine(0.0)), 'stop'), (0.08, tuple(ref.spine(0.0))), (0.25, (16.0, 0.0, 6.0)), (0.42, (18.0, 0.0, 0.0)),
                (0.6, (20.0, 0.0, 0.0)), (0.80, tuple(AIR['spine'])), (end, tuple(AIR['spine']), 'stop'))
    c.look = P((0.0, tuple(ref.look(0.0)), 'stop'), (0.12, (-35.0, 10.0)), (0.35, (-20.0, 25.0)), (0.6, (0.0, 30.0)), (end, tuple(AIR['look']), 'stop'))
    c.collar = P((0.0, tuple(ref.collar(0.0)), 'stop'), (0.2, (0.0, 0.0, 6.0, 6.0)), (0.6, tuple(AIR['collar'])), (end, tuple(AIR['collar']), 'stop'))
    c.curl = P((0.0, (1.0, 1.0), 'stop'), (0.05, (1.0, 1.0)), (0.14, (0.3, 0.1)), (0.3, (0.3, 0.2)), (end, (0.3, 0.3), 'stop'))
    c.finger_pose = ref.finger_pose
    pl0, pr0 = ref.poles(0.0)
    c.poles = lambda t: (Vector(pl0).lerp(V3(0.7, -0.8, -0.2), ease((t - 0.05) / 0.2)).lerp(Vector(AIR['poles'][0]), ease((t - 0.45) / 0.3)),
                         Vector(pr0).lerp(V3(-0.7, -0.8, -0.2), ease((t - 0.05) / 0.15)).lerp(Vector(AIR['poles'][1]), ease((t - 0.45) / 0.3)))
    kl0, kr0 = ref.knees(0.0)[:2]
    body_k = body_knees(c, AIR['knees'][0], AIR['knees'][1])

    def knees(t):
        e = ease((t - 0.45) / 0.3)
        bl, br = body_k(t)
        up = math.sin(math.pi * min(1.0, max(0.0, (t - 0.12) / 0.5))) ** 2  # (the left knee up over the cyclic)
        kl = Vector(kl0).lerp(V3(0.3, 1.0, -0.4), up).lerp(bl, e)
        kr = Vector(kr0).lerp(V3(0.3, 1.0, -0.2), ease((t - 0.1) / 0.2)).lerp(br, e)
        return (kl, kr, 1.0)
    c.knees = knees
    door = K([(0.0, 0.0), (0.16, 0.0, 'stop'), (0.24, 0.35), (0.45, 1.0, 'stop'), (end, 1.0, 'stop')])
    c.ctl = dict(ctl0, door=door)
    a = air_specs()

    def held(side, node):  # (the reference's own rolled grip, in the control's frame)
        palm, q = v0['hands'][side]
        m = veh.world(node, ctl0)
        return ('node', node, m.inverted() @ palm, (m.to_quaternion().inverted() @ q).normalized())
    coll, cyc = held('Left', 'collective'), held('Right', 'cyclic')
    di = veh.to_local('cockpit_door_R', V3(0.888, ch.E3.get('push_y', 1.47), -1.327), {'door': 0.0})
    dn = (veh.world('cockpit_door_R', {'door': 0.0}).to_3x3().inverted() @ V3(1, 0, 0)).normalized()
    glass = ('node', 'cockpit_door_R', di + dn * 0.005, ch._door_q(veh, hq((0.77, 0.17, 0.62), (0.38, -0.92, -0.05))))
    coll_up = ('V', veh.world('collective', ctl0) @ (coll[2] + V3(0.0, 0.06, 0.0)), (veh.world('collective', ctl0).to_quaternion() @ coll[3]).normalized())
    c.hand_keys = {'Left': [(0.0, coll), (0.03, coll), (0.10, coll_up), (0.3, ('chest', V3(0.30, -0.15, 0.30), AIR['qhand_l'])), (0.8, ('chest', A4H['hand_l1'], AIR['qhand_l']))],
                   'Right': [(0.0, cyc), (0.02, cyc), (0.18, glass), (0.22, glass), (0.45, ('chest', V3(-0.35, -0.15, 0.25), AIR['qhand_r'])), (0.8, a['hand']['Right'])]}
    fl, fr = ref.feet['Left'][0], ref.feet['Right'][0]
    pl = ('node', fl[3], fl[4], fl[5], fl[6])
    pr = ('node', fr[3], fr[4], fr[5], fr[6])
    step = ('ground', V3(*A4H['step_r']), 110.0, 0.0)
    over_l = ('V', V3(*A4H['out_l']), Ry(100.0) @ Rx(20.0))
    c.foot_keys = {'Left': [(0.0, pl), (0.14, pl), (0.62, over_l, 0.0, [V3(*v) for v in A4H['way_l']]), (0.82, a['foot']['Left'])],
                   'Right': [(0.0, pr), (0.12, pr), (0.40, step, 0.06, [V3(*v) for v in A4H['way_r']]), (0.62, step), (0.82, a['foot']['Right'])]}
    seat = veh.world('seat_pilot_point').translation
    c.root0 = (seat.x, seat.z, math.pi)
    c.root1 = (p1.x + 0.10, p1.z, math.radians(yaw1))
    c.root = None
    c.events = {'handsOff': 0.03, 'doorOpenStart': 0.16, 'doorOpenEnd': 0.45, 'unseated': 0.5, 'release': 0.80}
    c.contacts = 'planted'


# ---------------------------------------------------------------- the parachute (the "Parachute" subsection)
HANG = dict(  # hanging in the harness under the canopy: the hands at the toggles above the shoulders (body frames)
    turn_pitch=-5.0, spine=V3(4.0, 0.0, 0.0), look=V3(0.0, 12.0), collar=V3(0.0, -12.0, 0.0, -12.0),
    hand_l=V3(0.22, 0.52, 0.16), hand_r=V3(-0.22, 0.52, 0.16),  # (above the shoulders, a little forward: the arms up along the risers)
    qhand_l=hq((-0.4, 0.0, 1.0), (0.0, 1.0, 0.1)), qhand_r=hq((0.4, 0.0, 1.0), (0.0, 1.0, 0.1)),
    ankle_l=V3(0.11, -0.74, 0.12), ankle_r=V3(-0.11, -0.74, 0.08), qfoot_l=Ry(6.0) @ Rx(25.0), qfoot_r=Ry(-6.0) @ Rx(25.0),
    poles=(V3(0.8, -0.6, 0.0), V3(-0.8, -0.6, 0.0)), knees=(V3(0.1, 0.0, 1.0), V3(-0.1, 0.0, 1.0)),
    hip_l=V3(0.20, 0.04, 0.10), hip_r=V3(-0.20, 0.04, 0.10),  # (a toggle pulled down to the hip: the pelvis's frame)
    qhip_l=hq((-1.0, 0.0, 0.3), (0.0, -1.0, 0.2)), qhip_r=hq((1.0, 0.0, 0.3), (0.0, -1.0, 0.2)),
)


def hang_pose(c, left='up', right='up', life=None):
    """The hanging pose (para-hang frame 0) on c; a hand 'up' at its toggle or 'down' at the hip (a toggle pulled);
    life: (t) -> dict of offsets (the loop)."""
    h = AIR['hips'] + FIT.get('dy', 0.0)
    L = life or (lambda t: {})
    c.pelvis = lambda t: V3(0.0, h, 0.0) + L(t).get('pelvis', V3(0, 0, 0))
    c.turn = lambda t: V3(180.0, HANG['turn_pitch'], 0.0) + L(t).get('turn', V3(0, 0, 0))
    c.spine = lambda t: HANG['spine'] + L(t).get('spine', V3(0, 0, 0))
    c.look = lambda t: HANG['look'] + L(t).get('look', Vector((0, 0)))
    col = Vector(HANG['collar'])
    if left == 'down':
        col[1] = 4.0
    if right == 'down':
        col[3] = 4.0
    c.collar = lambda t: col + L(t).get('collar', Vector((0, 0, 0, 0)))
    c.curl = lambda t: Vector((0.75, 0.75))
    c.poles = lambda t: HANG['poles']
    c.knees = body_knees(c, HANG['knees'][0], HANG['knees'][1])
    c.root = lambda t: (0.0, 0.0, math.pi)
    hl = ('chest', HANG['hand_l'], HANG['qhand_l']) if left == 'up' else ('pelvis', HANG['hip_l'], HANG['qhip_l'])
    hr = ('chest', HANG['hand_r'], HANG['qhand_r']) if right == 'up' else ('pelvis', HANG['hip_r'], HANG['qhip_r'])
    if life:
        hl = ('chest_fn', (lambda t: HANG['hand_l'] + L(t).get('hand_l', V3(0, 0, 0))), HANG['qhand_l']) if left == 'up' else hl
        hr = ('chest_fn', (lambda t: HANG['hand_r'] + L(t).get('hand_r', V3(0, 0, 0))), HANG['qhand_r']) if right == 'up' else hr
        fl = ('pelvis_fn', (lambda t: HANG['ankle_l'] + L(t).get('foot_l', V3(0, 0, 0))), HANG['qfoot_l'])
        fr = ('pelvis_fn', (lambda t: HANG['ankle_r'] + L(t).get('foot_r', V3(0, 0, 0))), HANG['qfoot_r'])
    else:
        fl = ('pelvis', HANG['ankle_l'], HANG['qfoot_l'])
        fr = ('pelvis', HANG['ankle_r'], HANG['qfoot_r'])
    c.hand_keys = {'Left': [(0.0, hl)], 'Right': [(0.0, hr)]}
    c.foot_keys = {'Left': [(0.0, fl)], 'Right': [(0.0, fr)]}
    c.ctl = {}
    c.contacts = []
    c.events = {}


def hang_life(t):
    """para-hang's life (2 s loop; zero at t = 0): a slow sway in the harness, the legs swinging a little in turn, the
    head looking about, breathing."""
    w = 2 * math.pi / 2.0
    s = math.sin

    def per(k, ph):
        return s(w * k * t + ph) - s(ph)
    return {'turn': V3(2.0 * per(1, 0.6), 1.5 * per(1, 1.4), 3.0 * per(1, 0.0)), 'spine': V3(1.0 * per(2, 0.0), 0.0, -1.5 * per(1, 0.0)),
            'look': Vector((10.0 * per(1, 0.9), 3.0 * per(1, 2.0))), 'pelvis': V3(0.0, 0.006 * per(2, 0.3), 0.0),
            'foot_l': V3(0.0, 0.01 * per(1, 0.4), 0.05 * per(1, 0.4)), 'foot_r': V3(0.0, -0.01 * per(1, 0.4), -0.05 * per(1, 0.4)),
            'hand_l': V3(0.0, 0.012 * per(1, 0.0), 0.0), 'hand_r': V3(0.0, -0.012 * per(1, 0.0), 0.0),
            'collar': Vector((0.0, 1.0 * per(2, 0.0), 0.0, 1.0 * per(2, 0.0)))}


def para_deploy(c):
    """para-deploy (1.2 s), from the fall pose (fall frame 0): the right hand to the handle at the right hip (0-0.24),
    pulls it out and away (0.24-0.34, events.pull), the canopy streams out; the opening jerk (0.55, events.open): the body
    swings upright, the legs come down under it, the head nods; both hands up to the toggles (0.6-1.0); para-hang's
    frame 0 from 1.05."""
    h0 = AIR['hips'] + FIT.get('dy', 0.0)
    P = lambda *k: K(list(k))  # noqa: E731
    c.pelvis = P((0.0, (0.0, h0, 0.0)), (0.5, (0.0, h0, 0.0)), (0.6, (0.0, h0 - 0.06, 0.03)), (0.8, (0.0, h0 + 0.01, -0.01)), (1.05, (0.0, h0, 0.0), 'stop'), (1.2, (0.0, h0, 0.0), 'stop'))
    c.turn = P((0.0, (180.0, AIR['turn_pitch'], 0.0)), (0.3, (180.0, 16.0, -4.0)), (0.5, (180.0, 14.0, 0.0)), (0.62, (180.0, -14.0, 0.0)),
               (0.8, (180.0, -2.0, 0.0)), (1.05, (180.0, HANG['turn_pitch'], 0.0), 'stop'), (1.2, (180.0, HANG['turn_pitch'], 0.0), 'stop'))
    c.spine = P((0.0, tuple(AIR['spine'])), (0.3, (16.0, -6.0, -4.0)), (0.5, (12.0, 0.0, 0.0)), (0.62, (-4.0, 0.0, 0.0)), (0.8, (8.0, 0.0, 0.0)),
                (1.05, tuple(HANG['spine']), 'stop'), (1.2, tuple(HANG['spine']), 'stop'))
    c.look = P((0.0, tuple(AIR['look'])), (0.2, (-20.0, 35.0)), (0.4, (0.0, 20.0)), (0.6, (0.0, 30.0)), (0.75, (0.0, 0.0)), (1.05, tuple(HANG['look']), 'stop'), (1.2, tuple(HANG['look']), 'stop'))
    c.collar = P((0.0, tuple(AIR['collar'])), (0.5, tuple(AIR['collar'])), (0.9, tuple(HANG['collar'])), (1.2, tuple(HANG['collar']), 'stop'))
    c.curl = P((0.0, (0.3, 0.3)), (0.2, (0.3, 0.9)), (0.36, (0.3, 0.9)), (0.5, (0.3, 0.4)), (0.9, (0.75, 0.75)), (1.2, (0.75, 0.75), 'stop'))
    pl0, pr0 = AIR['poles']
    # (the right elbow back as the hand goes to the handle at the hip, out as it pulls, then as hanging)
    c.poles = lambda t: (Vector(pl0).lerp(Vector(HANG['poles'][0]), ease((t - 0.55) / 0.4)),
                         Vector(pr0).lerp(V3(-0.5, -0.5, -0.7), ease(t / 0.2)).lerp(V3(-0.8, -0.3, -0.4), ease((t - 0.24) / 0.2)).lerp(Vector(HANG['poles'][1]), ease((t - 0.6) / 0.35)))
    c.knees = body_knees(c, lambda t: Vector(AIR['knees'][0]).lerp(Vector(HANG['knees'][0]), ease((t - 0.5) / 0.4)),
                         lambda t: Vector(AIR['knees'][1]).lerp(Vector(HANG['knees'][1]), ease((t - 0.5) / 0.4)))
    c.root = lambda t: (0.0, 0.0, math.pi)
    a = air_specs()
    handle = ('pelvis', V3(-0.19, 0.0, -0.06), hq((1.0, 0.0, 0.0), (0.0, -1.0, 0.0)))  # (the handle at the harness's right hip)
    out = ('chest', V3(-0.50, -0.12, 0.16), hq((0.6, 0.0, 0.8), (-0.3, -1.0, 0.0)))  # (pulled out and away, the handle in the fist)
    up_l, up_r = ('chest', HANG['hand_l'], HANG['qhand_l']), ('chest', HANG['hand_r'], HANG['qhand_r'])
    c.hand_keys = {'Left': [(0.0, a['hand']['Left']), (0.6, a['hand']['Left']), (1.0, up_l), (1.2, up_l)],
                   'Right': [(0.0, a['hand']['Right']), (0.20, handle), (0.24, handle), (0.42, out), (0.62, out), (1.0, up_r), (1.2, up_r)]}
    hl, hr = ('pelvis', HANG['ankle_l'], HANG['qfoot_l']), ('pelvis', HANG['ankle_r'], HANG['qfoot_r'])
    c.foot_keys = {'Left': [(0.0, a['foot']['Left']), (0.52, a['foot']['Left']), (0.85, hl), (1.2, hl)],
                   'Right': [(0.0, a['foot']['Right']), (0.52, a['foot']['Right']), (0.85, hr), (1.2, hr)]}
    c.ctl = {}
    c.events = {'pull': 0.34, 'open': 0.55}
    c.contacts = []


def para_land(c):
    """para-land (1.5 s), from para-hang frame 0: both toggles down (the flare, 0-0.2), feet first onto the ground (0.25,
    events.ground), three running steps that slow (right 0.25, left 0.52, right 0.78, left 1.0), the toggles let go (0.45)
    and the arms down to the sides; standing by 1.35 (free), 2.0 m on."""
    st = ST_LAND + FIT.get('dy', 0.0)
    h0 = AIR['hips'] + FIT.get('dy', 0.0)
    g0 = 0.25
    P = lambda *k: K(list(k))  # noqa: E731
    dy = FIT.get('dy', 0.0)  # (the running steps' heights for this body's legs)
    c.pelvis = P((0.0, (0.0, h0, 0.0)), (0.15, (0.0, h0 - 0.10, -0.30)), (g0, (0.0, 0.86 + dy, -0.58)), (0.38, (0.0, 0.82 + dy, -0.88)), (0.52, (0.0, 0.88 + dy, -1.18)),
                 (0.65, (0.0, 0.83 + dy, -1.44)), (0.78, (0.0, 0.88 + dy, -1.66)), (0.9, (0.0, 0.85 + dy, -1.84)), (1.05, (0.0, 0.88 + dy, -1.96)), (1.35, (0.0, st, -2.02), 'stop'), (1.5, (0.0, st, -2.02), 'stop'))
    c.turn = P((0.0, (180.0, HANG['turn_pitch'], 0.0)), (0.15, (180.0, -10.0, 0.0)), (g0, (180.0, 4.0, 0.0)), (0.5, (180.0, 10.0, 0.0)),
               (0.9, (180.0, 6.0, 0.0)), (1.35, (180.0, 0.0, 0.0), 'stop'), (1.5, (180.0, 0.0, 0.0), 'stop'))
    c.spine = P((0.0, tuple(HANG['spine'])), (g0, (8.0, 0.0, 0.0)), (0.6, (10.0, 0.0, 0.0)), (1.35, (2.0, 0.0, 0.0), 'stop'), (1.5, (2.0, 0.0, 0.0), 'stop'))
    c.look = P((0.0, tuple(HANG['look'])), (0.2, (0.0, 25.0)), (0.6, (0.0, 15.0)), (1.35, (0.0, 8.0), 'stop'), (1.5, (0.0, 8.0), 'stop'))
    c.collar = P((0.0, tuple(HANG['collar'])), (0.2, (0.0, 4.0, 0.0, 4.0)), (0.8, (0.0, 0.0, 0.0, 0.0)), (1.5, (0.0, 0.0, 0.0, 0.0), 'stop'))
    c.curl = P((0.0, (0.75, 0.75)), (0.42, (0.75, 0.75)), (0.6, (0.3, 0.3)), (1.3, (0.25, 0.25), 'stop'))
    c.poles = lambda t: (Vector(HANG['poles'][0]).lerp(V3(0.7, -0.8, -0.2), ease(t / 0.3)), Vector(HANG['poles'][1]).lerp(V3(-0.7, -0.8, -0.2), ease(t / 0.3)))
    c.knees = body_knees(c, HANG['knees'][0], HANG['knees'][1])
    zr = Keys([(0.0, 0.0), (g0, -0.55), (0.9, -1.84), (1.35, -2.02)])
    c.root = lambda t: (0.0, zr(t), math.pi)
    up_l, up_r = ('chest', HANG['hand_l'], HANG['qhand_l']), ('chest', HANG['hand_r'], HANG['qhand_r'])
    dn_l, dn_r = ('pelvis', HANG['hip_l'], HANG['qhip_l']), ('pelvis', HANG['hip_r'], HANG['qhip_r'])
    c.hand_keys = {'Left': [(0.0, up_l), (0.3, dn_l), (0.48, dn_l), (0.92, _shoulder_spec('Left'))], 'Right': [(0.0, up_r), (0.3, dn_r), (0.48, dn_r), (0.92, _shoulder_spec('Right'))]}
    hl, hr = ('pelvis', HANG['ankle_l'], HANG['qfoot_l']), ('pelvis', HANG['ankle_r'], HANG['qfoot_r'])
    r1 = ('ground', V3(0.11, 0.0, -0.62), 178.0, 0.0)
    l1 = ('ground', V3(-0.11, 0.0, -1.20), 182.0, 0.0)
    r2 = ('ground', V3(0.11, 0.0, -1.68), 178.0, 0.0)
    l2 = ('ground', V3(-0.11, 0.0, -2.0), 181.0, 0.0)
    r3 = ('ground', V3(0.12, 0.0, -2.06), 178.0, 0.0)
    c.foot_keys = {'Right': [(0.0, hr), (0.1, hr), (g0, r1), (0.40, r1), (0.66, r2, 0.10), (0.92, r2), (1.12, r3, 0.06), (1.5, r3)],
                   'Left': [(0.0, hl), (0.15, hl), (0.36, ('pelvis', V3(0.11, -0.62, -0.10), HANG['qfoot_l'])), (0.52, l1), (0.70, l1), (0.95, l2, 0.08), (1.5, l2)]}
    c.ctl = {}
    c.events = {'ground': g0, 'free': 1.35}
    c.roll = ((g0, 1.5),)
    c.contacts = 'planted'


def para_pickup(c):
    """para-pickup (1.2 s, ground frame; the pack on a low crate in front, its top 0.45 m up, 0.5 m ahead): from standing,
    bending to it, both hands on the pack (0.34, events.grab), standing up the right hand swings it up over the right
    shoulder onto the back (0.4-0.85, events.onBack: from grab to onBack the pack goes with the right palm, then it is
    on spine_05), the left hand to the left strap, both hands down the straps and to the sides; standing (free 1.15)."""
    st = ST_LAND + FIT.get('dy', 0.0)
    P = lambda *k: K(list(k))  # noqa: E731
    c.pelvis = P((0.0, (0.0, st, 0.0), 'stop'), (0.3, (0.0, 0.66 + FIT.get('dy', 0.0), 0.06)), (0.4, (0.0, 0.66 + FIT.get('dy', 0.0), 0.06)), (0.7, (0.0, st - 0.02, 0.01)), (1.0, (0.0, st, 0.0), 'stop'), (1.2, (0.0, st, 0.0), 'stop'))
    c.turn = P((0.0, (180.0, 0.0, 0.0), 'stop'), (0.3, (180.0, 36.0, 0.0)), (0.4, (180.0, 34.0, 0.0)), (0.7, (176.0, 4.0, 0.0)), (1.0, (180.0, 0.0, 0.0), 'stop'), (1.2, (180.0, 0.0, 0.0), 'stop'))
    c.spine = P((0.0, (2.0, 0.0, 0.0), 'stop'), (0.3, (30.0, 0.0, 0.0)), (0.4, (28.0, 0.0, 0.0)), (0.65, (6.0, -12.0, 6.0)), (0.85, (4.0, -6.0, 2.0)), (1.05, (2.0, 0.0, 0.0), 'stop'), (1.2, (2.0, 0.0, 0.0), 'stop'))
    c.look = P((0.0, (0.0, 8.0), 'stop'), (0.3, (0.0, 40.0)), (0.45, (0.0, 30.0)), (0.75, (-20.0, 10.0)), (1.05, (0.0, 8.0), 'stop'), (1.2, (0.0, 8.0), 'stop'))
    c.collar = P((0.0, (0.0, 0.0, 0.0, 0.0), 'stop'), (0.35, (-4.0, 0.0, 4.0, 0.0)), (0.6, (0.0, 0.0, 8.0, -14.0)), (0.9, (0.0, 0.0, 0.0, 0.0)), (1.2, (0.0, 0.0, 0.0, 0.0), 'stop'))
    c.curl = P((0.0, (0.25, 0.25), 'stop'), (0.28, (0.2, 0.2)), (0.36, (0.8, 0.8)), (0.48, (0.3, 0.85)), (0.86, (0.8, 0.85)), (0.95, (0.8, 0.8)), (1.15, (0.25, 0.25), 'stop'))
    c.poles = lambda t: (V3(0.7, -0.8, -0.2), V3(-0.7, -0.8, -0.2).lerp(V3(-0.7, 0.4, -0.4), _bump01(t, 0.42, 0.62, 0.70, 1.0)))
    c.knees = body_knees(c, V3(0.1, 0.0, 1.0), V3(-0.1, 0.0, 1.0))
    c.root = lambda t: (0.0, 0.0, math.pi)
    pk_l = ground_hand(c, 'Left', V3(-0.11, 0.55, -0.45), (0.34, 0.42))
    pk_r = ground_hand(c, 'Right', V3(0.11, 0.55, -0.45), (0.34, 0.42))
    over_r = ('chest', V3(-0.20, 0.32, -0.04), hq((0.3, 0.0, -1.0), (0.0, 1.0, 0.0)))  # (over the right shoulder, the pack behind it)
    strap_r = ('chest', V3(-0.11, 0.16, 0.13), hq((0.0, 0.0, -1.0), (0.0, -1.0, 0.0)))  # (the right strap at the chest's front)
    strap_l = ('chest', V3(0.11, 0.16, 0.13), hq((0.0, 0.0, -1.0), (0.0, -1.0, 0.0)))
    c.hand_keys = {'Left': [(0.0, _shoulder_spec('Left')), (0.34, pk_l), (0.42, pk_l), (0.85, strap_l), (0.95, strap_l), (1.15, _shoulder_spec('Left'))],
                   'Right': [(0.0, _shoulder_spec('Right')), (0.34, pk_r), (0.42, pk_r), (0.72, over_r), (0.98, strap_r), (1.02, strap_r), (1.2, _shoulder_spec('Right'))]}
    fl = ('ground', V3(-0.11, 0.0, 0.0), 182.0, 0.0)
    fr = ('ground', V3(0.11, 0.0, 0.02), 178.0, 0.0)
    c.foot_keys = {'Left': [(0.0, fl), (1.2, fl)], 'Right': [(0.0, fr), (1.2, fr)]}
    c.ctl = {}
    c.events = {'grab': 0.34, 'onBack': 0.86, 'free': 1.15}
    c.contacts = 'planted'


def _bump01(t, a, b, cc, d):
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return ease((t - a) / (b - a))
    if t <= cc:
        return 1.0
    return 1.0 - ease((t - cc) / (d - cc))


def _a4h_ns():
    try:
        import bpy
        A4H.update({k: tuple(v) if isinstance(v, list) else v for k, v in bpy.app.driver_namespace.get('heli_A4H', {}).items()})
    except ImportError:
        pass


A4H = {  # (heli-jump's places, V: the right foot's way to the doorway's step; the left leg's up over the cyclic and out; the end)
    'step_r': (0.76, 0.83, -1.40), 'way_r': [(0.60, 0.99, -1.66), (0.72, 1.00, -1.50)],
    'way_l': [(0.30, 1.12, -1.80), (0.36, 1.62, -1.74), (0.52, 1.74, -1.62), (0.75, 1.60, -1.50), (1.00, 1.32, -1.42)],
    'out_l': (1.25, 1.10, -1.36),
    'p1': V3(1.50, 1.30, -1.32), 'yaw1': 110.0, 'p25': (0.50, 1.33, -1.24), 'y25': 160.0,  # (the hips back as the left leg swings over the cyclic: thigh 3.6 cm into its grip)
    'hand_l1': V3(0.48, -0.22, 0.10),  # (the left arm out but low at the end: the open door is beside it)
}


A4B = {  # (car-bail's places, V: the left foot over the sill and outside, the right under the rim and over the sill; the end)
    'sill_l': V3(-0.88, 0.70, -0.22), 'out_l': V3(-1.18, 0.40, -0.14), 'under_r': V3(-0.62, 0.42, -0.55), 'sill_r': V3(-0.95, 0.62, -0.24),
    'p1': V3(-1.38, 0.88, 0.18), 'yaw1': 250.0,
    'hand_r1': V3(-0.48, -0.26, 0.10),  # (the right arm out but low at the end: the open door's rear edge is over it)
    'way_l': [(-0.45, 0.43, -0.92), (-0.50, 0.47, -0.72), (-0.62, 0.52, -0.55), (-0.82, 0.60, -0.36), (-1.02, 0.58, -0.16)],  # (ankle points)
    # (the EarthOnline body: tried its own way out for the left foot from its place 5 cm further back, and its left knee
    # out to the door: the calf 6.1 / 7.0 cm into the footwell against 4.7 with Tripo's way and knee: kept Tripo's)
    'knee_up_l_ue5': (-0.3, 1.0, -0.2),
    'way_l_ue5': [(-0.42, 0.34, -0.88), (-0.44, 0.38, -0.74), (-0.56, 0.48, -0.58), (-0.80, 0.60, -0.38), (-1.02, 0.58, -0.16)],  # (low along the floor first, as its car-exit)
}


def make(name, veh, author):
    c = _make(name, veh, author)
    if c.finger_pose is None:  # (every athletic clip with the same open hand as car-bail's end: the joins hold at the fingers)
        from .pose import wheel_grip
        c.finger_pose = wheel_grip(author.fingers)
    from .pose import warp_of
    c.warp = warp_of(c)  # (a speed-limited time warp, slower only where a line is crossed: warps_a4.json)
    return c


def _make(name, veh, author):
    FIT.clear()
    FIT.update(BODY_FIT.get(_body_name(), {}))
    if name == 'fall':
        c = AClip(name, veh, author, 1.0, loop=True)
        fall(c)
        return c
    if name == 'car-bail':
        c = AClip(name, veh, author, 0.7)
        car_bail(c)
        return c
    if name == 'heli-jump':
        c = AClip(name, veh, author, 1.0)
        heli_jump(c)
        return c
    if name == 'para-hang':
        c = AClip(name, veh, author, 2.0, loop=True)
        hang_pose(c, life=hang_life)
        return c
    if name in ('para-steer-l', 'para-steer-r', 'para-flare'):  # (one-pose clips on para-hang frame 0: only the arms differ)
        c = AClip(name, veh, author, 0.0)
        hang_pose(c, left='down' if name in ('para-steer-l', 'para-flare') else 'up', right='down' if name in ('para-steer-r', 'para-flare') else 'up')
        return c
    if name == 'para-deploy':
        c = AClip(name, veh, author, 1.2)
        para_deploy(c)
        return c
    if name == 'para-land':
        c = AClip(name, veh, author, 1.5)
        para_land(c)
        return c
    if name == 'para-pickup':
        c = AClip(name, veh, author, 1.2)
        para_pickup(c)
        return c
    if name == 'bail-roll':
        c = AClip(name, veh, author, 1.9)
        bail_roll(c)
        c.ground_fit = load_fit(name)
        return c
    if name == 'land-hard':
        c = AClip(name, veh, author, 2.5)
        land_hard(c)
        c.ground_fit = load_fit(name)
        return c
    if name == 'land-roll':
        c = AClip(name, veh, author, 1.6)
        land_roll(c)
        c.ground_fit = load_fit(name)
        return c
    raise NotImplementedError(name)
