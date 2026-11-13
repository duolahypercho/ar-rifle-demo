"""(pass A4) Judging the athletic clips: the body against the ground plane (y = 0 of the clip's frame), per frame, and
the measures of the athletic gate (VEHICLE_NOTES.md "Third request"): ground contacts within 1.5 cm while planted, no
body part more than 3 cm into the ground while rolling (any frame, reported by part), joins, wrists, the hand's twist,
elbows and knees. The speed lines (hands / feet 8, head / pelvis 5 m/s, velocity change per 60 Hz sample 6 except
within 2 frames after events.ground) are speeds60's on the exported pack.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from rifle_motion import review
from rifle_motion.review import arms
from rifle_motion.skel import b2g, twist_angle


class GroundTest:
    """The posed body against the ground plane: the lowest point per body part (cm, - = under the ground)."""

    def __init__(self, body):
        self.body = body
        self.part = review.MeshTest(body, [], None).part

    def body_verts(self, root):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        x, z, yaw = root
        to_v = Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y')
        verts = [to_v @ b2g(mw @ v.co) for v in mesh.vertices]
        ev.to_mesh_clear()
        return verts

    def frame(self, root, ctl, contacts_on):
        verts = self.body_verts(root)
        low = {}
        for i, v in enumerate(verts):
            p = self.part[i]
            if v.y < low.get(p, math.inf):
                low[p] = v.y
        under = {p: round(-y * 100, 2) for p, y in low.items() if y < 0}
        lowest = min(low.values())
        limbs = ('hand_', 'foot_', 'ball_')
        trunk = min((y for p, y in low.items() if p and not p.startswith(limbs) and not review.is_finger(p)), default=lowest)
        return dict(pairs={}, contact={}, seat={}, headCm=math.inf, headBy=None, headByCm={}, depthCm={}, contactDepthCm={},
                    headTop=max(v.y for v in verts), sinkCm={'cushion': 0.0, 'back': 0.0, 'bolster': 0.0}, backGapCm=0.0, clearCm=math.inf,
                    groundUnderCm=under, lowestCm=round(lowest * 100, 2), lowestPart=min(low, key=low.get), lowTrunkCm=round(trunk * 100, 2))


def _arm(j, s):
    return j.endswith('_' + s) and (j.split('_')[0] in ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')
                                    or 'twist' in j or 'metacarpal' in j)


def join_rel(fa, fb, skip=()):
    """Pose difference of two frames relative to their pelvis (every joint, mm and deg): the join of a clip that
    starts from another's last pose in a different frame (the root's height and place apart)."""
    dp, dq, wp, wq = 0.0, 0.0, None, None
    pa, pb = fa['pos']['pelvis'], fb['pos']['pelvis']
    for j in fa['pos']:
        if j not in fb['pos'] or any(_arm(j, s) for s in skip):
            continue
        d = ((fa['pos'][j] - pa) - (fb['pos'][j] - pb)).length
        a = math.degrees(fa['rot'][j].rotation_difference(fb['rot'][j]).angle)
        a = min(a, 360 - a)
        if d > dp:
            dp, wp = d, j
        if a > dq:
            dq, wq = a, j
    return dp * 1000, dq, wp, wq


def measures(baked, meta, P, results, refs, roll=()):
    """refs: {label: (frame of this clip, other clip's baked frame)}; roll: [(t0, t1)] seconds (the roll's frames)."""
    n = len(baked)
    out = {}
    # ---- the ground
    under = {}
    worst_roll = [0.0, None, None]
    lowest, trunk = [], []
    for i, r in enumerate(results):
        lowest.append(r.get('lowestCm', 0.0))
        trunk.append(r.get('lowTrunkCm', 0.0))
        for p, d in r.get('groundUnderCm', {}).items():
            if d > under.get(p, (0.0, None))[0]:
                under[p] = (d, i)
            if any(a * 30 - 1e-6 <= i <= b * 30 + 1e-6 for a, b in roll) and d > worst_roll[0]:
                worst_roll = [d, i, p]
    out['groundUnderCm'] = {p: f'{d:.1f} at {i}' for p, (d, i) in sorted(under.items(), key=lambda kv: -kv[1][0])[:8]}
    out['groundUnderMaxCm'] = round(max((d for d, _ in under.values()), default=0.0), 2)
    out['rollUnderMaxCm'] = round(worst_roll[0], 2)
    out['rollUnderAt'] = f'{worst_roll[1]} ({worst_roll[2]})'
    out['lowestCm'] = lowest
    out['lowTrunkCm'] = trunk
    # ---- wrists, twist, elbows, knees
    wr = {'Left': [0.0, 0.0, None, None], 'Right': [0.0, 0.0, None, None]}
    elbow, knee = [math.inf, None], [math.inf, None]
    tw_prev, tw_step = {}, [0.0, None, None]
    past = []
    per = []
    for i, f in enumerate(baked):
        a = arms(f)
        per.append({sd: [round(v[2], 1), round(v[3], 1)] for sd, v in a.items()})
        for side, (bend, _, flex, dev) in a.items():
            w = wr[side]
            if abs(flex) > abs(w[0]):
                w[0], w[2] = flex, i
            if abs(dev) > abs(w[1]):
                w[1], w[3] = dev, i
            if bend < elbow[0]:
                elbow[:] = [bend, i]
            if abs(flex) > 70 or abs(dev) > 50:
                past.append((i, side[0], round(flex), round(dev)))
            s = side[0].lower()
            q = (f['rot']['lowerarm_' + s].inverted() @ f['rot']['hand_' + s]).normalized()
            t = math.degrees(twist_angle(q))
            if side in tw_prev:
                d = (t - tw_prev[side] + 180) % 360 - 180
                if abs(d) > tw_step[0]:
                    tw_step[:] = [abs(d), i, side]
            tw_prev[side] = t
        for s in ('l', 'r'):
            hip, kn, an = f['pos']['thigh_' + s], f['pos']['calf_' + s], f['pos']['foot_' + s]
            b = math.degrees((kn - hip).angle(an - kn))
            if b < knee[0]:
                knee[:] = [b, i]
    out['wristWorst'] = ' / '.join(f'{s} flex {w[0]:+.0f} (f{w[2]}) dev {w[1]:+.0f} (f{w[3]})' for s, w in wr.items())
    out['wristPast'] = past[:12]
    out['wristPerFrame'] = per
    out['twistStepDeg'] = round(tw_step[0], 1)
    out['twistAt'] = f'{tw_step[1]} ({tw_step[2]})'
    out['elbowMinDeg'] = round(elbow[0], 1)
    out['elbowAt'] = elbow[1]
    out['kneeMinDeg'] = round(knee[0], 1)
    out['kneeAt'] = knee[1]
    # ---- joins
    for label, (k, other) in refs.items():
        skip = tuple(x for x in ('l', 'r') if f'arm {x}' in label)  # (an additive pose: its own arm left out of the join)
        mm, deg, wp, wq = join_rel(baked[k], other, skip)
        out['join ' + label] = f'{mm:.1f} mm ({wp}) / {deg:.1f} deg ({wq})'
        out['joinMm ' + label] = round(mm, 2)
        out['joinDeg ' + label] = round(deg, 2)
    return out
