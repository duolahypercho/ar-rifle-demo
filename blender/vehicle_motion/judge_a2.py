"""Pass A2's measures for the clips that get in and out (on top of judge.py's): per frame and at the worst.

  depth      every body-against-vehicle pair (body part / vehicle part) with its depth (judge.VehicleTest.depths),
             split into soft (the seat: cushion, backrest, bolsters) and hard (everything else), worst per pair
             and the frames it is on
  wrists     flexion / deviation per side, worst over the clip (limits 60 / 45), and the frames past them
  twist      the hand's turn about the forearm against the forearm, worst step per frame (limit 30 deg)
  elbows     the least bend (limit 10 deg); knees: the least bend (a locked knee is under 8 deg)
  balance    the centre of mass (segment masses, Dempster's shares) against the support: the planted feet's
             sole points, the hands on holds, the seat under the hips; how far outside it gets, cm
  slide      a planted foot's sole point moving in its node's frame while its contact is on, mm per frame
  join       the pose error against the seated reference (car-drive / heli-fly frame 0) at the joining frame:
             every joint's position (mm) and turn (deg), the root applied
"""
import math

from mathutils import Matrix, Quaternion, Vector

from rifle_motion.review import arms
from rifle_motion.skel import twist_angle

SOFT = {'car': ('seat_driver',), 'heli': ('pilot_seat',)}
# where the hips rest on a seat (V): x, z ranges and the highest the pelvis joint is when sitting on it
SEAT_AREA = {'car': ((-0.80, -0.10), (-0.46, 0.20), 0.56), 'heli': ((0.15, 0.70), (-1.52, -0.95), 1.48)}
SEGMENTS = [  # (share of the mass, joints whose mean is the segment's centre)
    (0.081, ('head',)), (0.497, ('pelvis', 'neck_01')),
    (0.028, ('upperarm_l', 'lowerarm_l')), (0.028, ('upperarm_r', 'lowerarm_r')),
    (0.016, ('lowerarm_l', 'hand_l')), (0.016, ('lowerarm_r', 'hand_r')), (0.006, ('hand_l',)), (0.006, ('hand_r',)),
    (0.100, ('thigh_l', 'calf_l')), (0.100, ('thigh_r', 'calf_r')), (0.0465, ('calf_l', 'foot_l')), (0.0465, ('calf_r', 'foot_r')),
    (0.0145, ('foot_l', 'ball_l')), (0.0145, ('foot_r', 'ball_r')),
]


def to_v(root):
    x, z, yaw = root
    return Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y'), Quaternion((0, 1, 0), yaw)


def com(f, root):
    m, _ = to_v(root)
    c = Vector()
    for w, js in SEGMENTS:
        c += w * (sum((f['pos'][j] for j in js), Vector()) / len(js))
    return m @ c


def _hull(pts):
    pts = sorted(set((round(p[0], 4), round(p[1], 4)) for p in pts))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def _seg_dist(p, a, b):
    ax, az = b[0] - a[0], b[1] - a[1]
    L = ax * ax + az * az
    t = 0.0 if L < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / L))
    return math.hypot(p[0] - a[0] - t * ax, p[1] - a[1] - t * az)


def outside(p, pts):
    """How far the 2D point p is outside the convex hull of pts (0 inside)."""
    h = _hull(pts)
    if not h:
        return math.inf
    if len(h) == 1:
        return math.hypot(p[0] - h[0][0], p[1] - h[0][1])
    if len(h) == 2:
        return _seg_dist(p, h[0], h[1])
    inside = all((h[(i + 1) % len(h)][0] - h[i][0]) * (p[1] - h[i][1]) - (h[(i + 1) % len(h)][1] - h[i][1]) * (p[0] - h[i][0]) >= 0
                 for i in range(len(h)))
    if inside:
        return 0.0
    return min(_seg_dist(p, h[i], h[(i + 1) % len(h)]) for i in range(len(h)))


def measures(kind, baked, roots, meta, P, per_frame, reference=None):
    """per_frame: judge.VehicleTest.frame's results, one per frame. reference: (baked frame, root) of the seated
    reference pose this clip joins (its last frame for an enter clip, its first for an exit clip)."""
    n = len(baked)
    out = {}
    # ---- the body against the vehicle, with depths
    worst = {}
    for i, r in enumerate(per_frame):
        for key, d in r['depthCm'].items():
            w = worst.setdefault(key, [0.0, None, 0])
            w[2] += 1
            if d > w[0]:
                w[0], w[1] = d, i
    soft = {k: v for k, v in worst.items() if k.split('/')[1] in SOFT[kind]}
    hard = {k: v for k, v in worst.items() if k.split('/')[1] not in SOFT[kind]}
    out['hardPairs'] = {k: f'{v[0]:.1f} cm at {v[1]} ({v[2]} frames)' for k, v in sorted(hard.items(), key=lambda kv: -kv[1][0])}
    out['softPairs'] = {k: f'{v[0]:.1f} cm at {v[1]} ({v[2]} frames)' for k, v in sorted(soft.items(), key=lambda kv: -kv[1][0])}
    cw = {}
    for i, r in enumerate(per_frame):
        for key, d in r.get('contactDepthCm', {}).items():
            w = cw.setdefault(key, [0.0, None, 0])
            w[2] += 1
            if d > w[0]:
                w[0], w[1] = d, i
    out['contactPairsDepth'] = {k: f'{v[0]:.1f} cm at {v[1]} ({v[2]} frames)' for k, v in sorted(cw.items(), key=lambda kv: -kv[1][0])}
    out['hardMaxCm'] = round(max((v[0] for v in hard.values()), default=0.0), 2)
    out['softMaxCm'] = round(max((v[0] for v in soft.values()), default=0.0), 2)
    # ---- head clearance by part
    hb = {}
    for i, r in enumerate(per_frame):
        for w, d in r.get('headByCm', {}).items():
            if d < hb.get(w, (math.inf, 0))[0]:
                hb[w] = (d, i)
    out['headByCm'] = {w: f'{d:.1f} at {i}' for w, (d, i) in hb.items()}
    # ---- arms, wrists, twist, knees
    wr = {'Left': [0.0, 0.0, None, None], 'Right': [0.0, 0.0, None, None]}
    elbow = [math.inf, None]
    past = []
    tw_prev, tw_step = {}, [0.0, None, None]
    knee = [math.inf, None]
    for i, f in enumerate(baked):
        a = arms(f)
        bad = []
        for side, (bend, _, flex, dev) in a.items():
            w = wr[side]
            if abs(flex) > abs(w[0]):
                w[0], w[2] = flex, i
            if abs(dev) > abs(w[1]):
                w[1], w[3] = dev, i
            if bend < elbow[0]:
                elbow[:] = [bend, i]
            if abs(flex) > 60 or abs(dev) > 45:
                bad.append(side[0])
            s = side[0].lower()
            q = (f['rot']['lowerarm_' + s].inverted() @ f['rot']['hand_' + s]).normalized()
            t = math.degrees(twist_angle(q))
            if side in tw_prev:
                d = (t - tw_prev[side] + 180) % 360 - 180
                if abs(d) > tw_step[0]:
                    tw_step[:] = [abs(d), i, side]
            tw_prev[side] = t
        if bad:
            past.append(i)
        for s in ('l', 'r'):
            hip, kn, an = f['pos']['thigh_' + s], f['pos']['calf_' + s], f['pos']['foot_' + s]
            b = math.degrees((kn - hip).angle(an - kn))
            if b < knee[0]:
                knee[:] = [b, i]
    out['wristWorst'] = ' / '.join(f'{s} flex {w[0]:+.0f} (f{w[2]}) dev {w[1]:+.0f} (f{w[3]})' for s, w in wr.items())
    out['wristFramesPast'] = _runs(past)
    out['twistStepDeg'] = f'{tw_step[0]:.1f} at {tw_step[1]} ({tw_step[2]})'
    out['elbowMinDeg'] = f'{elbow[0]:.1f} at {elbow[1]}'
    out['kneeMinDeg'] = f'{knee[0]:.1f} at {knee[1]}'
    # ---- balance
    (x0, x1), (z0, z1), ymax = SEAT_AREA[kind]
    worst_b, bad_b = [0.0, None], []
    feet_on, hands_on = [dict() for _ in range(n)], [dict() for _ in range(n)]
    for c in meta['contacts']:
        for i in range(max(0, c['from']), min(n - 1, c['to']) + 1):
            (feet_on if c['part'].startswith('foot') else hands_on)[i][c['part'][-1]] = c
    for i, f in enumerate(baked):
        c = com(f, roots[i])
        pts = []
        for s in feet_on[i]:
            pts += [(P[i]['heel_' + s].x, P[i]['heel_' + s].z), (P[i]['sole_' + s].x, P[i]['sole_' + s].z)]
        for s in hands_on[i]:
            pts.append((P[i]['hand_' + s].x, P[i]['hand_' + s].z))
        pv = P[i]['pelvis']
        if x0 <= pv.x <= x1 and z0 <= pv.z <= z1 and pv.y <= ymax:
            # (the seat under the buttocks and thighs: +-0.15 across, 0.25 forward along the thighs, 0.10 back)
            yaw = roots[i][2]
            fw, rt = Vector((math.sin(yaw), 0, math.cos(yaw))), Vector((math.cos(yaw), 0, -math.sin(yaw)))
            pts += [((pv + rt * dx + fw * dz).x, (pv + rt * dx + fw * dz).z) for dx in (-0.15, 0.15) for dz in (-0.10, 0.25)]
        d = outside((c.x, c.z), pts) * 100 if pts else math.inf
        if d > worst_b[0]:
            worst_b[:] = [d, i]
        if d > 3.0:
            bad_b.append(i)
    out['balanceOutCm'] = f'{worst_b[0]:.1f} at {worst_b[1]}'
    out['balanceFramesOver3cm'] = _runs(bad_b)
    # ---- a planted foot sliding in its node's frame
    from . import vehicles  # noqa: F401
    slide = [0.0, None]
    for c in meta['contacts']:
        if not c['part'].startswith('foot'):
            continue
        s = c['part'][-1]
        prev = None
        for i in range(max(0, c['from']), min(n - 1, c['to']) + 1):
            p = P[i]['sole_' + s]
            m = meta['_veh'].world(c['node'], meta['_ctl'][i]) if c['node'] else Matrix.Identity(4)
            q = m.inverted() @ p
            if prev is not None and (q - prev).length > slide[0]:
                slide[:] = [(q - prev).length, i]
            prev = q
    out['plantSlideMmPerFrame'] = f'{slide[0] * 1000:.2f} at {slide[1]}'
    # ---- the join with the seated reference
    if reference is not None:
        (fa, ra), (fb, rb) = reference
        ma, qa = to_v(ra)
        mb, qb = to_v(rb)
        dp, dq, wp, wq = 0.0, 0.0, None, None
        for j in fa['pos']:
            if j not in fb['pos']:
                continue
            d = (ma @ fa['pos'][j] - mb @ fb['pos'][j]).length
            a = math.degrees((qa @ fa['rot'][j]).rotation_difference(qb @ fb['rot'][j]).angle)
            a = min(a, 360 - a)
            if d > dp:
                dp, wp = d, j
            if a > dq:
                dq, wq = a, j
        out['joinErr'] = f'{dp * 1000:.3f} mm ({wp}) / {dq:.3f} deg ({wq})'
    return out


def _runs(frames):
    if not frames:
        return '-'
    out, a = [], frames[0]
    for x, y in zip(frames, frames[1:] + [None]):
        if y != x + 1:
            out.append(f'{a}-{x}' if a != x else f'{a}')
            a = y
    return ', '.join(out)
