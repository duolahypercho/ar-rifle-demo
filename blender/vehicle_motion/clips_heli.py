"""The helicopter's clips (vehicle frame V of `helicopter_root`: forward -Z, the pilot front right, +X).

Fitted to the helicopter's geometry (LOD1 GLB, pass A1):
  pilot_seat cushion top y 1.19 to 1.20 over z -1.46..-1.10; backrest face from (y 1.26, z -1.03) to
  (y 1.92, z -0.86), 15 degrees back; overhead 2.13; floor 0.72; door sill y 0.84 over x 0.61..0.76.
  cyclic: pivot (0.42, 0.732, -1.635) on the floor, grip top y 1.374 at z -1.54..-1.48 (node frame
  (0, 0.57, 0.10)); collective: pivot (0.125, 0.79, -0.985), its front end (the grip) at z -1.49..-1.40,
  y 0.95..1.03; pedals: plates y 0.72..1.05, their back faces at z -2.12 (y 0.91) leaning forward 15 deg,
  x 0.26..0.35 (L) and 0.49..0.58 (R).
"""
import math

from mathutils import Quaternion, Vector

from . import vehicles
from rifle_motion.handling import ease

from .pose import Clip, K, V3, const, ground_for_ball, hq, sole_points, tail, warp_of, wheel_grip

SEAT_ROOT = (0.42, -1.19, math.pi)  # seat_pilot_point on the ground plane, facing forward
ENTRY_ROOT = (1.8, -1.55, -math.pi / 2)  # entry_cockpit_R: faces -X (towards the helicopter)

SEATED = dict(
    # (fitted, pass A1: like the car, the cockpit is small for a 1.75 m body in places: the collective's grip
    # is 0.16 m below the seat cushion at its bottom stop and the pedals 0.9 m ahead of the seat's front.
    # The pilot sits on the cushion's front half leaning forward 16 deg and a little to the left (the left
    # hand down to the collective, the right forearm low over the right thigh to the cyclic), feet on the
    # pedals toes up 38 deg, knees spread round the stick. The collective is held raised in flight (13 deg).)
    pelvis=V3(0.42, 1.318, -1.27),
    turn=V3(180.0, -8.0, -6.0),
    spine=V3(22.0, 2.0, -12.0),
    look=V3(0.0, 10.0),
    # (pass A3 follow-up: the seat 0.145 m forward (fit.py) puts the backrest against the back; the right shoulder
    # dropped and the elbow's pole down so the forearm rests on the thigh (skin gap 1.9 -> 0.5 cm))
    collar=V3(-2.0, -8.0, 4.0, -20.0),
    poles=(V3(1.0, -0.6, -0.4), V3(0.0, -1.0, 0.3)),
    # (on the pedals moved 0.25 m aft by the vehicle fit)
    ball_l=(V3(0.305, 0.87, -1.855), 186.0, 30.0),
    ball_r=(V3(0.54, 0.87, -1.855), 174.0, 30.0),
    # the right palm round the cyclic's grip, the left on the collective's front end (node frames): palm
    # point, palm normal, finger direction (the hand then rolls round the handle for its wrist)
    cyclic=(V3(0.03, 0.59, 0.115), (-1.0, 0.0, 0.0), (0.0, -0.5, -1.0), 0.0),
    collective=(V3(0.0, 0.245, -0.45), (0.5, -0.9, -0.2), (-0.5, -0.4, -0.75), 0.0),
)
# where the knees point (V): out either side of the cyclic (the pilot's left is -X)
KNEES = (V3(-0.5, 1.0, -0.5), V3(0.5, 1.0, -0.5))
# which control each one-pose clip moves, and to what (vehicles.py conventions)
POSES = {
    'heli-cyclic-f': {'fwd': vehicles.CYCLIC_DEG['fwd']}, 'heli-cyclic-b': {'fwd': -vehicles.CYCLIC_DEG['back']},
    'heli-cyclic-l': {'right': -vehicles.CYCLIC_DEG['side']}, 'heli-cyclic-r': {'right': vehicles.CYCLIC_DEG['side']},
    'heli-collective-up': {'coll': vehicles.COLLECTIVE_DEG['up']}, 'heli-collective-down': {'coll': vehicles.COLLECTIVE_DEG['down']},
    'heli-pedal-l': {'pedal': vehicles.PEDAL_M}, 'heli-pedal-r': {'pedal': -vehicles.PEDAL_M},
}


def _fit():
    s = dict(SEATED)
    try:
        import bpy
        s.update(bpy.app.driver_namespace.get('heli_fit', {}))
    except ImportError:
        pass
    return s


# each handle's axis (node frame): a point on it and its direction; a hand on it rolls round it for its
# wrist (pose.Clip.roll_on_handles)
AXES = {'cyclic': (V3(0.0, 0.59, 0.10), V3(0.0, 1.0, 0.35)), 'collective': (V3(0.0, 0.21, -0.45), V3(0.0, 0.40, -0.92))}


def grip(spec, node):
    at, palm, fingers, roll = spec
    return (Vector(at), hq(palm, fingers)) + AXES[node]


def seated(c, ctl=None, spread=(0.0, 0.0)):
    """spread: degrees more toes-out on (left, right): the knee opens round the stick with it."""
    s = _fit()
    s['ball_l'] = (s['ball_l'][0], s['ball_l'][1] + spread[0], s['ball_l'][2])
    s['ball_r'] = (s['ball_r'][0], s['ball_r'][1] - spread[1], s['ball_r'][2])
    c.pelvis = const(s['pelvis'])
    c.turn = const(s['turn'])
    c.spine = const(s['spine'])
    c.look = const(s['look'])
    c.collar = const(s['collar'])
    c.poles = lambda t: s['poles']
    c.curl = const((1.0, 1.0))
    base = {'door': 0.0, 'fwd': 0.0, 'right': 0.0, 'coll': vehicles.COLLECTIVE_DEG['fly'], 'pedal': 0.0}
    base.update(ctl or {})
    c.ctl = base
    sp = c.veh.world('seat_pilot_point').translation
    c.root = lambda t, r=(sp.x, sp.z, math.pi): r
    c.finger_pose = wheel_grip(c.author.fingers)
    kl, kr = s.get('knees', KNEES)
    c.knees = lambda t: (kl, kr)
    T = c.seconds + 1
    c.hands = {'Left': [('hold', 0.0, T, 'collective', *grip(s['collective'], 'collective'))],
               'Right': [('hold', 0.0, T, 'cyclic', *grip(s['cyclic'], 'cyclic'))]}
    feet = {}
    for side, key, node in (('Left', 'ball_l', 'pedal_L'), ('Right', 'ball_r', 'pedal_R')):
        ball, yaw, pitch = s[key]
        # the ball's place on the pedal moves with the pedal (node frame), the rest of the foot follows
        rest = c.veh.world(node, {}).inverted() @ Vector(ball)
        feet[side] = [('plant', 0.0, T, node, c.veh.world(node, {}).inverted() @ ground_for_ball(ball, yaw, pitch), yaw, pitch)]
    c.feet = feet
    n = c.n - 1
    c.contacts = [dict(part='hand_l', **{'from': 0}, to=n, node='collective', at=[round(x, 4) for x in s['collective'][0]], kind='grip'),
                  dict(part='hand_r', **{'from': 0}, to=n, node='cyclic', at=[round(x, 4) for x in s['cyclic'][0]], kind='grip')]
    for side, key, node in (('Left', 'ball_l', 'pedal_L'), ('Right', 'ball_r', 'pedal_R')):
        ball = c.veh.world(node, {}).inverted() @ Vector(s[key][0])
        c.contacts.append(dict(part='foot_' + side[0].lower(), **{'from': 0}, to=n, node=node, at=[round(x, 4) for x in ball], kind='press', point='ball'))
    c.events = {'handsOn': 0.0, 'seated': 0.0}


def _bump(t, a, b):
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** 2


def fly_life(t):
    """The seated loop's life (8 s; zero at t = 0): breathing, the head scanning out of the windows,
    small weight shifts."""
    w = 2 * math.pi / 8.0

    def per(k, ph):
        return math.sin(w * k * t + ph) - math.sin(ph)
    breath = per(2, 0.0) * 0.5 + per(4, 1.0) * 0.15
    scan_r = _bump(t, 1.2, 2.6)
    scan_l = _bump(t, 4.2, 5.6)
    panel = _bump(t, 6.3, 7.3)
    shift = per(1, 0.6)
    return {
        'pelvis': Vector((0.005 * shift, 0.0, 0.003 * per(1, 2.2))),
        'turn': Vector((1.0 * per(1, 1.1), 0.5 * per(2, 0.4), 1.2 * shift)),
        'spine': Vector((0.9 * breath, -6.0 * scan_r + 5.0 * scan_l, -0.8 * shift)),
        'look': Vector((-45.0 * scan_r + 40.0 * scan_l + 2.0 * per(3, 0.4), -4.0 * scan_r - 2.0 * scan_l + 18.0 * panel + 1.0 * per(2, 1.3))),
        'collar': Vector((0.8 * breath, 0.6 * breath, -0.8 * breath, 0.6 * breath)),
    }


def make(name, veh, author):
    if name in ('heli-seated', 'heli-fly'):
        c = Clip(name, veh, author, 8.0 if name == 'heli-fly' else 0.0, loop=name == 'heli-fly')
        seated(c)
        if name == 'heli-fly':
            c.alive = fly_life
            # the hands keep flying it: small cyclic and pedal corrections, the collective held
            c.ctl['fwd'] = lambda t: 0.8 * math.sin(2 * math.pi * t / 8.0 + 0.3) - 0.8 * math.sin(0.3) + 0.4 * math.sin(2 * math.pi * 3 * t / 8.0)
            c.ctl['right'] = lambda t: 0.6 * math.sin(2 * math.pi * 2 * t / 8.0 + 1.0) - 0.6 * math.sin(1.0)
            c.ctl['pedal'] = lambda t: 0.004 * math.sin(2 * math.pi * t / 8.0)
            c.curl = lambda t: (1.0 - 0.25 * _bump(t, 2.9, 3.6), 1.0)
        return c
    if name in POSES:
        c = Clip(name, veh, author, 0.0, loop=False)
        ctl = POSES[name]
        # the knees open round the stick where it comes over towards them
        spread = (0.0, 0.0)
        seated(c, ctl, spread)
        s = _fit()
        # what follows the control: the head and chest a touch with the stick, the knee with the pedal
        if 'fwd' in ctl:
            c.spine = const(s['spine'] + V3(0.25 * ctl['fwd'], 0.0, 0.0))
        if 'right' in ctl:
            c.spine = const(s['spine'] + V3(0.0, -0.3 * ctl['right'], 0.3 * ctl['right']))
        if 'coll' in ctl:
            # (down: the lever at its bottom stop is out of reach sitting as in flight: the pilot leans
            # further left and forward and drops the left shoulder)
            d = ctl['coll'] - vehicles.COLLECTIVE_DEG['fly']
            low = max(0.0, -d)
            c.spine = const(s['spine'] + V3(0.5 * low, 0.0, -0.9 * low))
            c.turn = const(s['turn'] + V3(0.0, 0.0, -0.4 * low))
            c.collar = const(s['collar'] + V3(0.0, -0.8 * low + 0.3 * max(0.0, d), 0.0, 0.0))
        return c
    if name == 'heli-enter':
        c = Clip(name, veh, author, 8.0, loop=False)
        enter2(c)
        from rifle_motion import body as body_table
        # (pass A4, Tripo: the hips `d` m higher between t1 and t2, easing in from t0 and out by t3: the left calf 4.7 cm
        # into the seat's front as the left foot comes off the skid onto the doorway's step, at the warp's instants)
        ups = (E2.get('a4_up') or []) if body_table.T.get('name') != 'civilian-m-01-player-ue5' else []
        if ups:
            pel_a4 = c.pelvis
            c.pelvis = lambda t: pel_a4(t) + V3(0.0, sum(u[4] * _bumpk(t, *u[:4]) for u in ups), 0.0)
        c.warp = warp_of(c)  # (pass A3 round 2: the speed-limited time warp, warps_a3.json)
        return c
    if name == 'heli-exit':
        from rifle_motion import body as body_table
        keep = dict(E3)
        if body_table.T.get('name') == 'civilian-m-01-player-ue5':  # (pass A3 round 2: its own values, E3['ue5'])
            E3.update(E3.get('ue5', {}))
        if A4['on']:
            E3['walk_stretch'] = 1.0
            E3.setdefault('push_y', A4['push_y'])  # (Tripo: the palm on the glass 2.7 cm lower: its wrist 51 deg off at the warp's instants)
        c = Clip(name, veh, author, A4['end'] if A4['on'] else 5.55 + (9.5 - 5.55) * E3.get('walk_stretch', 1.3), loop=False)
        exit3(c)
        if A4['on']:  # (pass A4: no walk round the door: two steps out of its swing, the door closing by itself)
            exit_a4_tail(c)
        E3.clear()
        E3.update(keep)
        c.warp = warp_of(c)
        return c
    raise NotImplementedError(name)


# ---------------------------------------------------------------- getting in and out (pass A2)
# Fitted to the helicopter (LOD1 GLB with the vehicle fit, V): cockpit_door_R hinged at its front edge
# (0.836, -, -2.192), radius to its rear edge 1.19 m (the swept area: z <= -1.0 near the fuselage); the doorway
# z -1.9 (front post) .. -0.99 (rear post, x 0.82..0.90, y 1.0..1.95), sill top y 0.82 at x 0.75, frame top
# y ~2.1; cabin floor 0.72 (x 0.15..0.60 in front of the seat, z -1.55..-1.85); the skid's tube top y 0.097 at
# x 1.10; the cyclic's stick between the knees (base z -1.635, grip z -1.51 y 1.37); seat cushion 1.17..1.20
# (x 0.20..0.65, z -1.50..-1.15).
SEAT_AREA = ((0.15, 0.70), (-1.52, -0.95), 1.48)
SEAT_PAD = (0.15, 0.35, 0.10)
HANDLE = V3(0.912, 1.012, -1.115)  # the door's outside handle (V, door shut), palm on its outer face
POST = V3(0.875, 1.70, -1.012)  # the doorway's rear post, its front face (V): the hand round its edge from the doorway
SKID = (1.10, 0.097)  # the skid tube's top (x, y), V
FLOOR = 0.73


def _flat(x, z, yaw, y=0.0):
    return (V3(x, y, z), yaw, 0.0)


def _bumpk(t, a, b, c, d):
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return ease((t - a) / (b - a))
    if t <= c:
        return 1.0
    return 1.0 - ease((t - c) / (d - c))


def hang(side, forward=0.07, out=0.03, down=0.57, roll=False):
    sx = 1 if side == 'Left' else -1
    p = V3(sx * out, -down, forward)
    if roll:
        return ('@shoulder_' + ('l' if side == 'Left' else 'r'), p, hq((-sx, 0, 0.1), (0, -1, 0.12)), p, V3(0, 1, 0), 50)
    # (no roll axis: pose.Clip.roll_on_handles smooths one side's rolls across all its rolled holds in a row, so a
    # rolled hanging hand would bleed into the next handle's roll)
    return ('@shoulder_' + ('l' if side == 'Left' else 'r'), p, hq((-sx, 0, 0.1), (0, -1, 0.12)))


def _door_local(veh, p, d=0.0):
    return veh.to_local('cockpit_door_R', p, {'door': d})


def _door_q(veh, q, d=0.0):
    return (veh.world('cockpit_door_R', {'door': d}).to_quaternion().inverted() @ q).normalized()


def _node_q(veh, node, q, d=0.0):
    return (veh.world(node, {'door': d}).to_quaternion().inverted() @ q).normalized()


def _door_dir(veh, v, d=0.0):
    return (veh.world('cockpit_door_R', {'door': d}).to_3x3().inverted() @ v).normalized()


def _end_pose():
    """The seated reference's channels and holds (heli-fly frame 0), as seated() sets them."""
    return _fit()


def enter(c):
    """heli-enter (pass A2), 8.0 s, from entry_cockpit_R (facing the helicopter, -X):
    0.0  standing at the helper (inside the door's swing); three short steps back and in (1.25)
    1.05 right hand to the door's outside handle (1.4), pulls it open to 40 % stepping back with the right foot
         (2.0), lets go (the door stays)
    2.1  left foot onto the skid (2.5); left hand to the doorway's rear post (2.5)
    2.7  right foot up over the sill to the cabin floor right of the cyclic (3.3)
    3.3  weight up onto it, ducking under the frame; left hand off the post (3.6); left foot off the skid, over
         the sill and in front of the stick to the floor left of it (3.45-4.3); turning to the front
    4.0  down onto the seat's front edge (4.4), back into the seat (5.2)
    5.2  leans out to the right, right hand to the door's inner face (5.6), pulls it shut (5.6-6.3), lets go,
         it latches (6.45)
    5.5  feet to the pedals (6.4); left hand to the collective (6.9), right hand to the cyclic (7.0); settled
         from 7.4 on heli-fly frame 0."""
    veh = c.veh
    s = _end_pose()
    seat_r = veh.world('seat_pilot_point').translation
    P = lambda *k: K(list(k))  # noqa: E731
    E = globals().get('HELI_FIT', {})
    st = 0.90
    pe, tu, sp = tuple(s['pelvis']), tuple(s['turn']), tuple(s['spine'])
    c.pelvis = P((0.0, (1.80, 0.915, -1.55)), (0.25, (1.79, st, -1.54)), (0.55, (1.76, st - 0.005, -1.44)), (0.9, (1.64, st - 0.01, -1.34)),
                 (1.2, (1.49, st - 0.02, -1.07)), (1.45, (1.38, st - 0.04, -0.95), 'stop'), (2.0, (1.52, st - 0.02, -0.88)),
                 (2.5, (1.30, st - 0.03, -1.06)), (2.85, (1.22, st + 0.0, -1.18)),
                 *E.get('pelvis', [(3.2, (1.12, 0.98, -1.28)), (3.6, (0.92, 1.22, -1.44)), (4.0, (0.74, 1.34, -1.40)),
                                   (4.4, (0.58, 1.35, -1.30)), (4.8, (0.49, 1.34, -1.30)), (5.2, (0.46, 1.335, -1.30)),
                                   (5.3, (0.53, 1.335, -1.31)), (5.8, (0.52, 1.33, -1.30)), (6.3, (0.44, 1.322, -1.28))]),
                 (6.7, pe, 'stop'))
    c.turn = P((0.0, (270.0, 0.0, 0.0)), (0.25, (270.0, 0.0, 0.0)), (0.95, (266.0, 2.0, 0.0)), (1.25, (264.0, 6.0, -2.0)),
               (1.45, (262.0, 14.0, -4.0), 'stop'), (2.0, (266.0, 4.0, 0.0)), (2.5, (268.0, 8.0, 0.0)), (2.9, (264.0, 14.0, 0.0)),
               *E.get('turn', [(3.3, (254.0, 24.0, 0.0)), (3.6, (242.0, 28.0, 0.0)), (4.0, (222.0, 28.0, 0.0)), (4.4, (200.0, 16.0, -2.0)),
                               (4.8, (188.0, 8.0, -4.0)), (4.6, (182.0, 2.0, 0.0)), (5.3, (190.0, 10.0, 26.0)), (5.8, (184.0, 4.0, 10.0)), (6.3, (180.0, -6.0, -4.0))]),
               (6.7, tu, 'stop'))
    c.spine = P((0.0, (2.0, 0.0, 0.0)), (0.25, (2.0, 0.0, 0.0)), (1.45, (12.0, 4.0, 4.0), 'stop'), (2.0, (4.0, 0.0, 0.0)),
                (2.9, (8.0, 0.0, 0.0)),
                *E.get('spine', [(3.3, (12.0, 0.0, 0.0)), (3.6, (14.0, 0.0, 0.0)), (4.0, (14.0, 0.0, 0.0)), (4.4, (14.0, 0.0, -2.0)),
                                 (4.8, (16.0, 0.0, -4.0)), (4.6, (16.0, 0.0, -2.0)), (5.3, (14.0, 12.0, 40.0)), (5.8, (16.0, 6.0, 14.0)), (6.3, (20.0, 2.0, -6.0))]),
                (6.7, sp, 'stop'))
    c.look = P((0.0, (0.0, 8.0)), (0.6, (-10.0, 10.0)), (1.1, (-30.0, 15.0)), (1.8, (-35.0, 5.0)), (2.3, (10.0, 30.0)),
               (2.9, (-20.0, 35.0)), (3.6, (0.0, 30.0)), (4.2, (30.0, 30.0)), (4.8, (-40.0, 20.0)), (5.6, (-30.0, 15.0)),
               (6.2, (0.0, 15.0)), (6.7, tuple(s['look']), 'stop'))
    c.collar = P((0.0, (0.0, 0.0, 0.0, 0.0)), (1.45, (0.0, 0.0, 8.0, 8.0)), (2.0, (0.0, 0.0, 0.0, 0.0)), (2.5, (-6.0, 8.0, 0.0, 0.0)),
                 (3.4, (-6.0, 8.0, 0.0, 0.0)), (4.6, (0.0, 0.0, 0.0, 0.0)), (5.3, (0.0, 0.0, 14.0, 8.0)), (5.9, (0.0, 0.0, 4.0, 0.0)),
                 (6.7, tuple(s['collar']), 'stop'))
    c.poles = lambda t: (V3(0.7, -0.8, -0.2), V3(-0.7, -0.8, -0.2)) if t < 6.0 else s['poles']
    base = {'door': 0.0, 'fwd': 0.0, 'right': 0.0, 'coll': vehicles.COLLECTIVE_DEG['fly'], 'pedal': 0.0}
    c.ctl = dict(base)
    c.ctl['door'] = K([(0.0, 0.0), (1.45, 0.0, 'stop'), (1.75, 0.33), (2.1, 0.6, 'stop'), (5.3, 0.6, 'stop'), (5.95, 0.05), (6.1, 0.0, 'stop')])
    c.curl = K([(0.0, (0.25, 0.25)), (1.1, (0.25, 0.4)), (1.4, (0.25, 0.6)), (1.75, (0.25, 0.6)), (2.0, (0.25, 0.4)), (2.2, (0.25, 0.4)),
                (2.4, (0.4, 0.25)), (2.5, (0.85, 0.25)), (3.3, (0.85, 0.25)), (3.5, (0.3, 0.25)), (5.1, (0.3, 0.4)), (5.3, (0.3, 0.6)),
                (5.95, (0.3, 0.6)), (6.1, (0.3, 0.4)), (6.4, (0.6, 0.6)), (6.7, (1.0, 1.0), 'stop')])
    c.finger_pose = wheel_grip(c.author.fingers)
    hl = _door_local(veh, HANDLE)
    pull_v = V3(0.845, 1.42, -1.39)  # the door's window, inner face, 0.9 m from the hinge (V, shut): a flat hand pulls it in
    pull = veh.to_local('cockpit_door_R_glass', pull_v + V3(-0.03, 0, 0), {'door': 0.0})  # (the palm 3 cm inside the glass: a hand on a pull strap)
    gq17 = lambda q: (veh.world('cockpit_door_R_glass', {'door': 0.17}).to_quaternion().inverted() @ q).normalized()  # noqa: E731
    gq = lambda q: (veh.world('cockpit_door_R_glass', {'door': 0.0}).to_quaternion().inverted() @ q).normalized()  # noqa: E731  # the door's inner face, 0.7 m from the hinge, shoulder high (V, shut)
    end = 7.4
    c.hands = {
        'Right': [('hold', 0.0, 1.05, *hang('Right')), ('move', 1.05, 1.4, [V3(1.10, 0.98, -1.12)], 0.01),
                  ('hold', 1.4, 1.75, 'cockpit_door_R', hl, _door_q(veh, hq((-0.77, 0.32, -0.56), (0.0, -0.5, 0.87)), 0.3), hl + V3(0.012, 0, 0), V3(0, 0, 1), 60),
                  ('move', 1.75, 2.3, [V3(1.55, 1.00, -1.00)], 0.0), ('hold', 2.3, 4.75, *hang('Right', 0.12, 0.0, 0.45)),
                  ('move', 4.75, 5.3, [], 0.01),
                  ('hold', 5.3, 5.95, 'cockpit_door_R_glass', pull, gq17(hq((-0.93, -0.3, -0.21), (-0.36, -0.46, -0.81))), pull + veh.world('cockpit_door_R_glass', {'door': 0.0}).to_3x3().inverted() @ V3(0.03, 0, 0), V3(0, 1, 0), 40),
                  ('move', 5.95, 6.85, [V3(0.66, 1.45, -1.40)], 0.005),
                  ('hold', 6.85, end + 1, 'cyclic', *grip(s['cyclic'], 'cyclic'))],
        'Left': [('hold', 0.0, 2.15, *hang('Left')), ('move', 2.15, 2.5, [V3(1.10, 1.30, -1.00)], 0.01),
                 ('hold', 2.5, 3.0, 'fuselage', POST, hq((-0.56, 0.32, 0.77), (-0.87, 0.5, 0.0)), POST + V3(0.0, 0, 0.015), V3(0, 1, 0), 60),
                 ('move', 3.0, 3.7, [V3(1.02, 1.52, -1.10)], 0.01), ('hold', 3.7, 5.9, *hang('Left', 0.22, 0.0, 0.38)),
                 ('move', 5.9, 6.85, [V3(0.24, 1.34, -1.42)], 0.005),
                 ('hold', 6.85, end + 1, 'collective', *grip(s['collective'], 'collective'))],
    }
    c.auto_contacts = {('Right', 2): 'handle', ('Right', 6): 'grip', ('Right', 8): 'grip', ('Left', 2): 'grip', ('Left', 6): 'grip'}
    feet_end = {}
    for side, key, node in (('Left', 'ball_l', 'pedal_L'), ('Right', 'ball_r', 'pedal_R')):
        ball, yaw, pitch = s[key]
        feet_end[side] = ('plant', None, end + 1, node, veh.world(node, {}).inverted() @ ground_for_ball(ball, yaw, pitch), yaw, pitch)
    sx, sy = SKID
    c.feet = {
        'Right': [('plant', 0.0, 0.55, None, *_flat(1.80, -1.65, 270.0)), ('step', 0.55, 0.9, 0.05, []),
                  ('plant', 0.9, 1.2, None, *_flat(1.57, -1.36, 268.0)), ('step', 1.2, 1.45, 0.04, []),
                  ('plant', 1.45, 1.55, None, *_flat(1.39, -1.05, 266.0)), ('step', 1.55, 1.9, 0.05, []),
                  ('plant', 1.9, 2.55, None, *_flat(1.54, -1.02, 268.0)),
                  ('step', 2.55, 3.0, 0.0, E.get('viaR', [V3(1.40, 0.45, -1.14), V3(1.10, 0.98, -1.48), V3(0.80, 0.98, -1.62)])),
                  ('plant', 3.0, 4.9, 'interior', *_flat(0.62, -1.64, 225.0, 0.78)), ('step', 4.9, 5.35, 0.05, []),
                  ('plant', 5.35,) + feet_end['Right'][2:]],
        'Left': [('plant', 0.0, 0.25, None, *_flat(1.80, -1.45, 270.0)), ('step', 0.25, 0.55, 0.05, []),
                 ('plant', 0.55, 0.9, None, *_flat(1.70, -1.32, 268.0)), ('step', 0.9, 1.2, 0.05, []),
                 ('plant', 1.2, 2.1, None, *_flat(1.46, -0.90, 266.0)), ('step', 2.1, 2.5, 0.06, []),
                 ('plant', 2.5, 3.15, 'skid_R', *_flat(sx, -1.14, 266.0, sy)),
                 ('step', 3.15, 4.3, 0.0, E.get('viaL', [V3(1.06, 0.50, -1.22), V3(0.86, 1.10, -1.66), V3(0.50, 1.02, -1.77), V3(0.28, 0.86, -1.72)])),
                 ('plant', 4.3, 5.2, 'interior', *_flat(0.22, -1.62, 190.0, FLOOR)), ('step', 5.2, 5.6, 0.05, []),
                 ('plant', 5.6,) + feet_end['Left'][2:]],
    }
    c.auto_contacts.update({('footLeft', 6): 'step', ('footRight', 6): 'step', ('footLeft', 8): 'rest',
                            ('footLeft', 10): 'press', ('footRight', 8): 'press'})
    kl0, kr0 = KNEES

    def knees(t):
        # (both knees up while climbing; out round the stick once in, as the seated pose has them)
        a = ease((t - 3.8) / 0.5)
        kl = V3(0.2, 1.0, -0.3).lerp(Vector(kl0), a).lerp(V3(-0.9, 0.5, -0.3), _bumpk(t, 3.9, 4.2, 5.8, 6.3))
        kr = V3(0.0, 1.0, -0.3).lerp(Vector(kr0), a)
        return (kl, kr, 1.0 if t >= 4.0 else _bumpk(t, 2.4, 2.8, 9.0, 9.5))
    c.knees = knees
    c.root0, c.root1 = ENTRY_ROOT, (seat_r.x, seat_r.z, math.pi)
    c.balance, c.seat_area, c.seat_pad, c.fixed_roll, c.balance_lead = True, SEAT_AREA, SEAT_PAD, False, 2
    c.events = {'doorOpenStart': 1.45, 'doorOpenEnd': 2.0, 'seated': 4.8, 'doorCloseStart': 5.3, 'doorCloseEnd': 6.1, 'handsOn': 6.6}


def exit_(c):
    """heli-exit (pass A2), 6.0 s, from heli-fly frame 0 to standing at entry_cockpit_R facing the helicopter:
    0.0  hands off the cyclic and the collective, feet off the pedals to the floor (0.9)
    0.6  leans to the door, right palm on the window's inner face (1.0), pushes the door open to 60 % (1.6)
    1.6  right hand to the doorway's rear post (2.0); turning on the seat to face out; left foot across in front
         of the stick to the doorway (2.4); left hand on the seat's right edge (2.2)
    2.2  rises out of the seat, ducking under the frame, and lowers out of the doorway: left foot down to the skid
         (2.9), right foot to the ground (3.4), left foot to the ground (3.85); right hand off the post (3.6)
    4.0  turns to the door, right hand on its outer face (4.15), swings it shut (4.15-4.5), it latches (4.8)
    4.9  two steps back to stand at the helper facing the helicopter, hands at the sides (5.5); still to 6.0."""
    veh = c.veh
    s = _end_pose()
    P = lambda *k: K(list(k))  # noqa: E731
    pe, tu, sp = tuple(s['pelvis']), tuple(s['turn']), tuple(s['spine'])
    st = 0.915
    c.pelvis = P((0.0, pe, 'stop'), (0.5, pe, 'stop'), (0.6, (0.44, 1.322, -1.28)), (1.0, (0.47, 1.33, -1.29)), (1.6, (0.50, 1.35, -1.30)),
                 (2.2, (0.60, 1.40, -1.36)), (2.6, (0.78, 1.34, -1.36)), (3.05, (0.95, 0.94, -1.27)), (3.5, (1.20, 0.92, -1.14)),
                 (3.85, (1.42, 0.90, -1.02)), (4.2, (1.54, 0.89, -0.94)), (4.5, (1.60, 0.88, -0.88)), (4.95, (1.58, 0.90, -1.14)), (5.35, (1.72, 0.905, -1.40)),
                 (5.75, (1.80, st, -1.55), 'stop'))
    c.turn = P((0.0, tu, 'stop'), (0.5, tu, 'stop'), (0.6, (182.0, 0.0, 0.0)), (1.0, (182.0, 6.0, 4.0)), (1.6, (176.0, 4.0, 4.0)),
               (2.2, (140.0, 18.0, 0.0)), (2.6, (108.0, 26.0, 0.0)), (2.9, (96.0, 24.0, 0.0)), (3.4, (100.0, 14.0, 0.0)),
               (3.85, (120.0, 8.0, 0.0)), (4.15, (160.0, 10.0, 0.0)), (4.5, (190.0, 8.0, 0.0)), (4.95, (220.0, 2.0, 0.0)), (5.35, (252.0, 1.0, 0.0)),
               (5.75, (270.0, 0.0, 0.0), 'stop'))
    c.spine = P((0.0, sp, 'stop'), (0.5, sp, 'stop'), (0.6, (14.0, 4.0, 2.0)), (1.0, (14.0, 6.0, 6.0)), (1.6, (14.0, 4.0, 6.0)),
                (2.2, (16.0, 0.0, 0.0)), (2.6, (16.0, 0.0, 0.0)), (3.4, (8.0, 0.0, 0.0)), (4.15, (10.0, 4.0, 0.0)),
                (4.5, (10.0, 6.0, 4.0)), (5.75, (2.0, 0.0, 0.0), 'stop'))
    c.look = P((0.0, tuple(s['look']), 'stop'), (0.5, tuple(s['look']), 'stop'), (0.9, (-30.0, 15.0)), (1.2, (-40.0, 15.0)), (1.8, (-20.0, 20.0)), (2.4, (0.0, 35.0)),
               (3.0, (10.0, 40.0)), (3.6, (0.0, 20.0)), (4.2, (-10.0, 10.0)), (4.8, (20.0, 10.0)), (5.6, (0.0, 8.0), 'stop'))
    c.collar = P((0.0, tuple(s['collar']), 'stop'), (0.5, tuple(s['collar']), 'stop'), (1.0, (-2.0, -8.0, 4.0, 0.0)), (1.0, (0.0, 0.0, 10.0, 6.0)), (1.6, (0.0, 0.0, 6.0, 6.0)),
                 (2.4, (0.0, 0.0, 6.0, 8.0)), (3.6, (0.0, 0.0, 0.0, 0.0)), (4.3, (0.0, 0.0, 8.0, 6.0)), (5.0, (0.0, 0.0, 0.0, 0.0)))
    c.poles = lambda t: s['poles'] if t < 0.5 else (V3(0.7, -0.8, -0.2), V3(-0.2, -1.0, -0.3) if t < 1.8 else V3(-0.3, -1.0, 0.3) if t < 3.4 else V3(-0.7, -0.8, -0.2))
    base = {'door': 0.0, 'fwd': 0.0, 'right': 0.0, 'coll': vehicles.COLLECTIVE_DEG['fly'], 'pedal': 0.0}
    c.ctl = dict(base)
    c.ctl['door'] = K([(0.0, 0.0), (1.05, 0.0, 'stop'), (1.35, 0.32), (1.75, 0.6, 'stop'), (4.2, 0.6, 'stop'), (4.45, 0.35), (4.8, 0.0, 'stop')])
    c.curl = K([(0.0, (1.0, 1.0), 'stop'), (0.5, (1.0, 1.0), 'stop'), (0.7, (0.5, 0.4)), (0.9, (0.3, 0.3)), (1.0, (0.3, 0.3)), (1.6, (0.3, 0.3)), (2.4, (0.3, 0.4)),
                (2.6, (0.3, 0.85)), (3.25, (0.3, 0.85)), (3.45, (0.3, 0.3)), (4.0, (0.3, 0.4)), (4.2, (0.3, 0.85)), (4.45, (0.3, 0.85)),
                (3.8, (0.25, 0.3)), (4.6, (0.25, 0.3)), (4.9, (0.25, 0.25))])
    c.finger_pose = wheel_grip(c.author.fingers)
    push_v = V3(0.825, 1.42, -1.39)  # the window's inner face (V, door shut): the palm pushes it out
    push = veh.to_local('cockpit_door_R_glass', push_v, {'door': 0.0})
    gq = lambda q, d: (veh.world('cockpit_door_R_glass', {'door': d}).to_quaternion().inverted() @ q).normalized()  # noqa: E731
    outp = _door_local(veh, HANDLE)  # the door's outside handle
    post = V3(0.86, 1.70, -1.015)
    end = 6.0
    c.hands = {
        'Right': [('hold', 0.0, 0.5, 'cyclic', *grip(s['cyclic'], 'cyclic')), ('move', 0.5, 1.0, [V3(0.60, 1.48, -1.40), V3(0.74, 1.42, -1.42)], 0.01),
                  ('hold', 1.0, 1.35, 'cockpit_door_R_glass', push, gq(hq((0.77, 0.32, 0.56), (0.0, -0.5, -0.87)), 0.18), push, V3(1, 0, 0), 40),
                  ('move', 1.35, 1.8, [], 0.01), ('hold', 1.8, 2.25, *hang('Right', 0.15, 0.0, 0.45, True)),
                  ('move', 2.25, 2.6, [], 0.01),
                  ('hold', 2.6, 3.25, 'fuselage', post, hq((0.17, 0.3, 0.94), (0.5, 0.87, 0.0)), post + V3(0.0, 0, 0.015), V3(0, 1, 0), 60),
                  ('move', 3.25, 3.6, [], 0.01), ('hold', 3.6, 3.85, *hang('Right')), ('move', 3.85, 4.2, [], 0.01),
                  ('hold', 4.2, 4.45, 'cockpit_door_R', outp, _door_q(veh, hq((-0.75, 0.0, 0.66), (-0.66, -0.12, -0.75)), 0.45), outp + V3(0.012, 0, 0), V3(0, 0, 1), 60),
                  ('move', 4.45, 5.2, [], 0.0), ('hold', 5.2, end + 1, *hang('Right'))],
        'Left': [('hold', 0.0, 0.35, 'collective', *grip(s['collective'], 'collective')), ('move', 0.35, 0.9, [], 0.0),
                 ('hold', 0.9, 3.2, *hang('Left', 0.15, 0.0, 0.45)), ('move', 3.2, 3.6, [], 0.01), ('hold', 3.6, end + 1, *hang('Left'))],
    }
    c.auto_contacts = {('Right', 0): 'grip', ('Right', 2): 'push', ('Right', 6): 'grip', ('Right', 10): 'handle', ('Left', 0): 'grip'}
    feet0 = {}
    for side, key, node in (('Left', 'ball_l', 'pedal_L'), ('Right', 'ball_r', 'pedal_R')):
        ball, yaw, pitch = s[key]
        feet0[side] = (node, veh.world(node, {}).inverted() @ ground_for_ball(ball, yaw, pitch), yaw, pitch)
    sx, sy = SKID
    c.feet = {
        'Right': [('plant', 0.0, 0.55) + feet0['Right'], ('step', 0.55, 0.85, 0.04, []),
                  ('plant', 0.85, 3.1, 'interior', *_flat(0.60, -1.48, 196.0, 0.80)),
                  ('step', 3.1, 3.45, 0.0, [V3(0.85, 0.98, -1.30), V3(1.20, 0.50, -1.02)]),
                  ('plant', 3.45, 3.95, None, *_flat(1.42, -1.00, 100.0)), ('step', 3.95, 4.25, 0.05, []),
                  ('plant', 4.25, 4.6, None, *_flat(1.58, -0.90, 160.0)), ('step', 4.6, 4.95, 0.06, []),
                  ('plant', 4.95, 5.4, None, *_flat(1.70, -1.32, 230.0)), ('step', 5.4, 5.7, 0.05, []),
                  ('plant', 5.7, end + 1, None, *_flat(1.80, -1.65, 270.0))],
        'Left': [('plant', 0.0, 0.6) + feet0['Left'], ('step', 0.6, 0.95, 0.04, []),
                 ('plant', 0.95, 1.9, 'interior', *_flat(0.24, -1.62, 190.0, FLOOR)),
                 ('step', 1.9, 2.45, 0.0, [V3(0.28, 1.10, -1.80), V3(0.55, 1.15, -1.84)]),
                 ('plant', 2.45, 2.6, 'interior', *_flat(0.66, -1.72, 120.0, 0.80)),
                 ('step', 2.6, 3.05, 0.0, [V3(0.80, 1.18, -1.58), V3(1.02, 1.08, -1.48), V3(1.14, 0.45, -1.35)]),
                 ('plant', 3.05, 3.5, 'skid_R', *_flat(sx, -1.28, 96.0, sy)), ('step', 3.5, 3.85, 0.05, []),
                 ('plant', 3.85, 5.0, None, *_flat(1.44, -1.14, 140.0)), ('step', 5.0, 5.35, 0.06, []),
                 ('plant', 5.35, end + 1, None, *_flat(1.80, -1.45, 270.0))],
    }
    c.auto_contacts.update({('footLeft', 0): 'press', ('footRight', 0): 'press', ('footLeft', 2): 'rest', ('footRight', 2): 'rest',
                            ('footLeft', 4): 'step', ('footLeft', 6): 'step', ('footRight', 4): 'ground'})
    kl0, kr0 = KNEES

    def knees(t):
        a = ease((t - 1.4) / 0.5)
        kl = Vector(kl0).lerp(V3(0.0, 1.0, -0.3), a)
        kr = Vector(kr0).lerp(V3(0.3, 1.0, 0.0), a)
        return (kl, kr, 1.0 if t <= 3.0 else 1.0 - ease((t - 3.0) / 0.6))
    c.knees = knees
    seat_r = veh.world('seat_pilot_point').translation
    c.root0, c.root1 = (seat_r.x, seat_r.z, math.pi), ENTRY_ROOT
    c.balance, c.seat_area, c.seat_pad, c.fixed_roll, c.balance_lead = True, SEAT_AREA, SEAT_PAD, False, 2
    c.events = {'doorOpenStart': 1.05, 'doorOpenEnd': 1.6, 'unseated': 2.2, 'doorCloseStart': 4.2, 'doorCloseEnd': 4.8, 'handsOff': 0.5}


DOOR_TOP = V3(-0.203, 1.013, 0.465)  # cockpit_door_R frame: the door's window frame, inner side, near its top front (open: V 1.19, 1.99, -1.84)
SILL = (0.80, 0.82)  # the doorway's sill top (x, y), V
STEP_FLOOR = 0.745  # the cabin floor's top in the doorway


def _down_pose(veh, author):
    """heli-collective-down (the seated reference with the collective at its bottom stop, as on the ground)."""
    return make('heli-collective-down', veh, author)


def enter2(c):
    """heli-enter (pass A2 follow-up), 8.0 s, from entry_cockpit_R facing the helicopter, the door shut:
    0.0  steps back out of the door's swing (0.8)
    0.8  right hand on the outside handle (1.1), pulls the door open to 40 % (1.5); it swings full open (68 deg) by 2.2
    1.8  left hand on the doorway's rear post (2.2); left foot up onto the skid (2.2-2.55)
    2.6  right foot up into the doorway onto the floor (3.15), weight up onto it, crouched under the frame
    3.2  left foot off the skid onto the sill (3.65); turns in the doorway to face out, the back to the seat
    3.9  sits back onto the seat's right edge (4.6), right hand on the door frame's front post
    4.7  turns to the front on the seat: right leg in to the floor right of the cyclic (5.4); the left leg lifted
         over the cyclic's grip, knee high, to the floor left of it (5.3-6.1); slides back into the seat
    6.0  leans out to the right, right hand up to the open door's window frame (6.4), pulls it in and shut (6.4-7.1)
    7.0  hands to the collective (at its bottom stop, as on the ground) and the cyclic, feet to the pedals; settled from
         7.7 on heli-collective-down (heli-fly frame 0 with the collective fully down)."""
    veh = c.veh
    cd = _down_pose(veh, c.author)
    c.join_ref = 'heli-collective-down'
    P = lambda *k: K(list(k))  # noqa: E731
    st = 0.90
    pe, tu, sp = tuple(cd.pelvis(0.0)), tuple(cd.turn(0.0)), tuple(cd.spine(0.0))
    sx, sy = SKID
    end = 8.0
    E2['pe'] = pe
    c.pelvis = P((0.0, (1.80, 0.915, -1.55)), (0.35, (1.78, st - 0.04, -1.52)), (0.65, (1.66, st - 0.06, -1.34)), (0.85, (1.42, st - 0.05, -1.02), 'stop'), (1.1, (1.36, st - 0.035, -0.98), 'stop'),
                 (1.5, (1.60, st - 0.03, -0.88)), (1.9, (1.52, st - 0.01, -0.90)), (2.2, (1.38, st - 0.02, -1.18), 'stop'),
                 (2.55, (1.34, 0.84, -1.15)), (2.85, (1.22, 0.90, -1.28)), (3.15, (1.10, 0.98, -1.36)), (3.45, (0.98, 1.04, -1.40)),
                 (3.65, (0.92, 1.12, -1.38)), (3.95, (0.84, 1.26, -1.34)), (4.3, (0.72, 1.36, -1.31)), (4.6, (0.63, 1.40, -1.30), 'stop'),
                 (5.0, (0.62, 1.37, -1.30)), (5.5, (0.56, 1.37, -1.29)), (6.0, (0.56, 1.36, -1.29)), (6.5, E2.get('p65', (0.62, 1.39, -1.30))),
                 (7.1, E2.get('p71', (0.45, 1.33, -1.27))), (7.45, pe, 'stop'))
    c.turn = P((0.0, (270.0, 0.0, 0.0)), (0.35, (268.0, 0.0, 0.0)), (0.8, (262.0, 2.0, 0.0), 'stop'), (1.1, (258.0, 6.0, 2.0), 'stop'),
               (1.5, E2.get('t15', (262.0, 4.0, 0.0))), (1.9, E2.get('t19', (268.0, 6.0, 0.0))), (2.2, (270.0, 10.0, 0.0), 'stop'), (2.55, (272.0, 20.0, 0.0)),
               (2.85, (262.0, 24.0, 0.0)), (3.2, (238.0, 24.0, 0.0)), (3.6, (215.0, 20.0, 0.0)), (4.0, (204.0, 14.0, 0.0)),
               (4.6, (196.0, 8.0, 0.0), 'stop'), (5.0, (192.0, 4.0, 0.0)), (5.5, (184.0, 0.0, 0.0)),
               (6.0, (180.0, 2.0, 8.0)), (6.5, E2.get('t65', (205.0, 15.0, 15.0))), (6.85, (188.0, 4.0, 2.0)), (7.25, tu, 'stop'), (7.4, tu, 'stop'), (7.7, tu, 'stop'))
    c.spine = P((0.0, (2.0, 0.0, 0.0)), (0.8, (2.0, 0.0, 0.0), 'stop'), (1.1, (8.0, 4.0, -6.0), 'stop'), (1.5, (4.0, 0.0, 0.0)),
                (2.2, (8.0, 0.0, 0.0), 'stop'), (2.9, (18.0, 0.0, 0.0)), (3.2, (22.0, 0.0, 0.0), 'stop'), (3.9, (24.0, 0.0, 0.0), 'stop'),
                (4.6, (16.0, 0.0, 0.0), 'stop'), (5.5, (14.0, 0.0, 0.0)), (6.0, (12.0, 0.0, 16.0)), (6.5, E2.get('s65', (15.0, 15.0, 25.0))), (6.85, (14.0, 4.0, 4.0)),
                (7.25, sp, 'stop'), (7.5, sp, 'stop'), (7.7, sp, 'stop'))
    c.look = P((0.0, (0.0, 8.0)), (0.5, (10.0, 10.0)), (1.1, (-20.0, 15.0)), (1.8, (20.0, 10.0)), (2.4, (0.0, 35.0)), (3.0, (0.0, 30.0)),
               (3.6, (-30.0, 20.0)), (4.2, (0.0, 30.0)), (5.0, (-30.0, 35.0)), (5.8, (10.0, 30.0)), (6.4, (-40.0, -10.0)), (6.75, (-10.0, 12.0)),
               (7.0, (-25.0, 5.0)), (7.8, tuple(cd.look(0.0)), 'stop'))
    c.collar = P((0.0, (0.0, 0.0, 0.0, 0.0)), (1.1, (0.0, 0.0, 8.0, 8.0)), (1.8, (0.0, 0.0, 0.0, 0.0)), (2.4, (-6.0, 8.0, 0.0, 0.0)),
                 (3.4, (-4.0, 4.0, 0.0, 0.0)), (4.6, (0.0, 0.0, 4.0, 6.0)), (6.4, (0.0, 0.0, 14.0, 10.0)), (7.0, (0.0, 0.0, 6.0, 0.0)),
                 (7.4, tuple(cd.collar(0.0)), 'stop'), (7.7, tuple(cd.collar(0.0)), 'stop'))
    pref = cd.poles(0.0)
    c.poles = lambda t: (V3(0.7, -0.8, -0.2), V3(-0.7, -0.8, -0.2)) if t < 7.0 else pref
    c.ctl = {'door': K([(0.0, 0.0), (1.1, 0.0, 'stop'), (1.45, 0.35), (1.7, 0.40), (1.9, 0.47), (2.3, 1.0, 'stop'), (6.4, 1.0, 'stop'), (6.75, 0.25), (7.15, 0.0, 'stop')]),
             'fwd': 0.0, 'right': 0.0, 'coll': vehicles.COLLECTIVE_DEG['down'], 'pedal': 0.0}
    c.curl = K([(0.0, (0.25, 0.25)), (0.8, (0.25, 0.4)), (1.1, (0.25, 0.35)), (1.33, (0.25, 0.35)), (1.45, (0.25, 0.0)), (1.7, (0.25, 0.25)), (2.0, (0.4, 0.3)),
                (2.2, (0.8, 0.3)), (2.85, (0.8, 0.3)), (3.0, (0.3, 0.3)), (4.2, (0.3, 0.7)), (4.7, (0.3, 0.7)), (4.9, (0.3, 0.3)),
                (6.2, (0.3, 0.4)), (6.4, (0.3, 0.8)), (7.1, (0.3, 0.8)), (7.55, (0.4, 0.4)), (7.7, (1.0, 1.0), 'stop')])
    c.finger_pose = wheel_grip(c.author.fingers)
    hl = _door_local(veh, HANDLE)
    seat_l = veh.to_local('pilot_seat', V3(0.42, 1.225, -1.32), {})
    seat_up = (veh.world('pilot_seat', {}).to_3x3().inverted() @ V3(0, 1, 0)).normalized()
    hl2 = _door_local(veh, HANDLE + V3(0.015, 0.0, 0.0))
    hh = veh.to_local('cockpit_door_R_handle', HANDLE + V3(0.03, 0.0, 0.0), {'door': 0.0})
    hx = (veh.world('cockpit_door_R_handle', {'door': 0.0}).to_3x3().inverted() @ V3(1, 0, 0)).normalized()
    hz = (veh.world('cockpit_door_R_handle', {'door': 0.0}).to_3x3().inverted() @ V3(0, 0, 1)).normalized()
    door_q1 = lambda q: _door_q(veh, q, 1.0)  # noqa: E731
    door_q45 = lambda q: _door_q(veh, q, 0.45)  # noqa: E731
    c.hands = {
        'Right': [('hold', 0.0, 0.75, *hang('Right')), ('move', 0.75, 1.03, [V3(1.22, 1.02, -1.08)], 0.0),
                  ('hold', 1.03, E2.get('h_end', 1.45), 'cockpit_door_R_handle', hh, _node_q(veh, 'cockpit_door_R_handle', hq((-0.77, 0.32, -0.56), (0.0, -0.5, 0.87))), hh + hx * 0.012, hz, 40),
                  ('move', E2.get('h_end', 1.45), 1.9, E2.get('hx', [V3(1.52, 1.02, -1.20), V3(1.52, 1.02, -0.98)]), 0.0), ('hold', 1.9, 3.85, *hang('Right', *E2.get('hr19', (0.16, -0.04, 0.48)))),
                  ('move', 3.85, 4.2, [], 0.0), ('hold', 4.2, 6.0, *hang('Right', 0.26, 0.02, 0.40)),
                  ('move', 6.0, 6.4, [V3(0.95, 1.62, -1.70)], 0.0),
                  ('hold', 6.4, 6.75, 'cockpit_door_R', DOOR_INF, door_q1(hq(*DOOR_INF_Q)), DOOR_INF, V3(0, 1, 0), 40),
                  ('move', 6.75, 7.0, [], 0.0), ('hold', 7.0, 7.1, *hang('Right', 0.30, 0.10, 0.35)), ('move', 7.1, 7.7, [], 0.0), ('hold', 7.7, end + 1, *cd.hands['Right'][0][3:])],
        'Left': [('hold', 0.0, 1.75, *hang('Left')), ('move', 1.75, 2.2, [], 0.0),
                 ('hold', 2.2, 3.05, 'fuselage', POST + V3(*E2.get('lpost', (0.012, 0, 0.012))), hq((-0.56, 0.32, 0.77), (-0.87, 0.5, 0.0)), POST + V3(0.012, 0, 0.027), V3(0, 1, 0), 40),
                 ('move', 3.05, 3.6, [], 0.0),
                 ('hold', 3.6, 3.8, 'pilot_seat', seat_l, hq((0.0, -1.0, 0.0), (-0.7, 0.0, -0.7)), seat_l, seat_up, 90),
                 ('move', 3.8, 4.4, [], 0.0), ('hold', 4.4, 6.9, *hang('Left', 0.12, 0.0, 0.45)),
                 ('move', 6.9, 7.55, E2.get('lcv', [V3(0.22, 1.40, -1.30)]), 0.0), ('hold', 7.55, end + 1, *cd.hands['Left'][0][3:])],
    }
    c.auto_contacts = {('Right', 2): 'handle', ('Right', 8): 'grip', ('Right', 12): 'grip', ('Left', 2): 'grip', ('Left', 4): 'rest', ('Left', 8): 'grip'}
    fl, fr = cd.feet['Left'][0], cd.feet['Right'][0]
    c.feet = {
        'Left': [('plant', 0.0, 0.3, None, *_flat(1.80, -1.45, 270.0)), ('step', 0.3, 0.6, 0.05, []),
                 ('plant', 0.6, 2.05, None, *_flat(1.60, -1.02, 266.0)), ('step', 2.05, 2.55, 0.14, []),
                 ('plant', 2.55, 3.3, 'skid_R', *_flat(sx, -1.18, 266.0, sy)),
                 ('step', 3.3, 3.72, 0.06, E2.get('viaS', [V3(0.98, 0.80, -1.24)])),
                 ('plant', 3.72, 5.0, None, *_flat(*E2.get('lstep', (0.77, -1.34)), 214.0, 0.83)),
                 ('step', 5.0, 6.4, 0.05, E2.get('viaL', [V3(0.72, 1.15, -1.50), V3(0.68, 1.45, -1.58), V3(0.58, 1.69, -1.64), V3(0.47, 1.77, -1.68), V3(0.36, 1.74, -1.72), V3(0.27, 1.58, -1.75), V3(0.24, 1.12, -1.76)])),
                 ('plant', 6.4, 7.0, None, *_flat(0.26, -1.72, 186.0, STEP_FLOOR)), ('step', 7.0, 7.45, 0.05, []),
                 ('plant', 7.45, end + 1) + fl[3:]],
        'Right': [('plant', 0.0, 0.6, None, *_flat(1.80, -1.65, 270.0)), ('step', 0.6, 0.97, 0.05, []),
                  ('plant', 0.97, 1.6, None, *_flat(1.46, -1.12, 262.0)), ('step', 1.6, 1.9, 0.05, []),
                  ('plant', 1.9, 2.56, None, *_flat(1.50, -1.12, 262.0)),
                  ('step', 2.56, 3.45, 0.05, E2.get('viaR', [V3(1.28, 0.55, -1.36), V3(1.08, 0.90, -1.50), V3(0.86, 1.02, -1.64)])),
                  ('plant', 3.45, 6.9, None, *_flat(0.58, -1.74, 176.0, STEP_FLOOR)), ('step', 6.9, 7.35, 0.05, []),
                  ('plant', 7.35, end + 1) + fr[3:]],
    }

    if E2.get('pedal_direct', True):  # (pass A3: the left foot from over the cyclic straight onto its pedal, its calf clear of the
        # seat's front (0.145 m further forward with the pilot's fit))
        c.feet['Left'] = c.feet['Left'][:-3] + [('plant', 6.4, end + 1) + fl[3:]]
    def knees(t):
        kl = V3(0.0, 1.0, -0.3).lerp(E2.get('kl_out', V3(-0.6, 0.6, -0.4)), ease((t - 5.6) / 0.5))
        kr = V3(0.0, 1.0, -0.3)
        w = _bumpk(t, 2.0, 2.4, 6.6, 7.4)
        k0 = cd.knees(0.0)
        return (Vector(k0[0]).lerp(kl, w), Vector(k0[1]).lerp(kr, w), 1.0)
    c.knees = knees
    c.auto_contacts.update({('footLeft', 4): 'step', ('footLeft', 6): 'rest', ('footLeft', 8): 'press' if E2.get('pedal_direct', True) else 'rest',
                            ('footLeft', 10): 'press', ('footRight', 6): 'rest', ('footRight', 8): 'press'})
    seat_r = veh.world('seat_pilot_point').translation
    c.root0, c.root1 = ENTRY_ROOT, (seat_r.x, seat_r.z, math.pi)
    c.balance, c.seat_area, c.seat_pad, c.fixed_roll = True, SEAT_AREA, SEAT_PAD, True
    c.seated_from = 5.0
    c.smooth_runs = True
    c.balance_skip = ((0.0, 2.2), (2.5, 4.7))  # (the walk's single steps; the climb held by the hands)
    c.step_clear = E2.get('clear', 0.15)  # (pass A3: feet straight up off and down onto their places: no slide near a surface)
    if E2.get('lead'):  # (pass A3 round 2: a foot on its pedal a little before its plant)
        c.contact_lead = dict(E2['lead'])
    c.events = {'doorOpenStart': 1.1, 'doorOpenEnd': 2.2, 'seated': 4.6, 'doorCloseStart': 6.4, 'doorCloseEnd': 7.15, 'handsOn': 7.7,
                'seatedPose': 'heli-collective-down'}
    _adapt_body(c)


def _adapt_body(c):
    """(pass A2 follow-up 2) heli-enter's plan retargeted to the EarthOnline bodies (civilian-m-01-player-ue5 and the
    roster on its joints): legs 0.78 m against Tripo's 0.82, so the hips go lower while the feet carry the weight
    (E2['ue5_dy'] m), easing to the plan's own heights as they settle on the seat; the trunk bent further forward
    under the doorway's top (E2['ue5_lean'] deg) where the seat's edge is reached. Tripo's clip is unchanged."""
    from rifle_motion import body as body_table
    if body_table.T.get('name') != 'civilian-m-01-player-ue5':
        return
    dy, lean = E2.get('ue5_dy', 0.035), E2.get('ue5_lean', 8.0)
    pel, spn = c.pelvis, c.spine
    w = lambda t: 1.0 - ease((t - E2.get('ue5_w0', 4.2)) / 0.5)  # noqa: E731
    c.pelvis = lambda t: pel(t) - V3(0.0, dy * w(t), 0.0)
    tur, lk = c.turn, c.look
    c.spine = lambda t: spn(t) + V3(lean * _bumpk(t, 3.5, 3.9, 4.8, 5.3), 0.0, 0.0)
    c.turn = lambda t: tur(t) + V3(0.0, E2.get('ue5_pitch', 0.0) * _bumpk(t, 3.5, 3.9, 4.8, 5.3), 0.0)
    c.look = lambda t: lk(t) + Vector((0.0, E2.get('ue5_look', 0.0) * _bumpk(t, 3.5, 3.9, 4.8, 5.3)))
    # (pass A3 follow-up, fitting: its feet's places on the vehicle raised `ue5_lift` m, a step's own way / pitch, by
    # 'Side t0' keys; a hand hold's own place)
    lift = E2.get('ue5_lift', 0.0)
    for side, plan in c.feet.items():
        n = len(plan)
        if E2.get('ue5_debug'):
            print('UE5H feet', side, [(st[0], round(st[1], 3), round(st[2], 3), st[3] if st[0] != 'step' else len(st[4])) for st in plan])
        for k, st in enumerate(plan):
            key = '%s %.2f' % (side, st[1])
            if st[0] == 'plant' and (st[3] is not None or Vector(st[4]).y > 0.1) and 0 < k < n - 1 and lift:
                plan[k] = st[:4] + (Vector(st[4]) + V3(0.0, lift, 0.0),) + st[5:]
            elif st[0] == 'step':
                own = E2.get('ue5_vias', {}).get(key)
                if own:
                    plan[k] = st[:4] + ([Vector(v) for v in own],) + st[5:]
                pf = E2.get('ue5_pitch_k', {}).get(key)
                if pf:
                    def _pk(x, ks=tuple(map(tuple, pf))):
                        if x <= ks[0][0]:
                            return ks[0][1]
                        for (xa, pa), (xb, pb) in zip(ks, ks[1:]):
                            if x <= xb:
                                return pa + (pb - pa) * ease((x - xa) / (xb - xa))
                        return ks[-1][1]
                    plan[k] = plan[k][:5] + (_pk,)
    for side, plan in c.hands.items():
        if E2.get('ue5_debug'):
            print('UE5H hands', side, [(st[0], round(st[1], 3), round(st[2], 3), st[3] if st[0] == 'hold' else '') for st in plan])
        for k, st in enumerate(plan):
            key = '%s %.2f' % (side, st[1])
            own = E2.get('ue5_hvias', {}).get(key) if st[0] == 'move' else None
            if own:
                plan[k] = st[:3] + ([Vector(v) for v in own],) + st[4:]
            hg = E2.get('ue5_hang', {}).get(key) if st[0] == 'hold' else None
            if hg:  # (a hanging hand's own place: forward, out, down from its shoulder)
                plan[k] = st[:3] + tuple(hang(side, *hg))
    ups = E2.get('ue5_up') or []
    if ups and not isinstance(ups[0], (list, tuple)):
        ups = [ups]
    if ups:  # (the hips `d` m higher between t1 and t2, easing in from t0 and out by t3; [t0, t1, t2, t3, d] each)
        pel2 = c.pelvis
        c.pelvis = lambda t: pel2(t) + V3(0.0, sum(u[4] * _bumpk(t, *u[:4]) for u in ups), 0.0)
    kq = E2.get('ue5_kl')
    if kq:  # (the left knee's pole towards `pole` between t1 and t2: [t0, t1, t2, t3, pole])
        kn0 = c.knees
        c.knees = lambda t: (lambda k: (Vector(k[0]).lerp(Vector(kq[4]), _bumpk(t, *kq[:4])),) + tuple(k[1:]))(kn0(t))
    ho = E2.get('ue5_hold_end', {})
    for side, plan in c.hands.items():  # (a hold ending earlier: 'Side t0' -> its new end, the move after it starting there)
        for k, st in enumerate(plan):
            e = ho.get('%s %.2f' % (side, st[1])) if st[0] == 'hold' else None
            if e and k + 1 < len(plan):
                plan[k] = st[:2] + (e,) + st[3:]
                plan[k + 1] = plan[k + 1][:1] + (e,) + plan[k + 1][2:]


FRONT_POST = V3(0.86, 1.55, -1.90)  # the doorway's front post (V): the right hand on it as the hips go down
front_q = hq((-0.3, 0.0, -0.95), (0.0, 1.0, 0.0))
DOOR_TOP_Q = ((-0.95, 0.2, 0.2), (0.2, 0.3, -0.93))
DOOR_INF = V3(-0.068, 0.709, 0.284)  # the door's inner frame, its rear lower window corner (door local): nearest a seated pilot leaning out
DOOR_INF_Q = ((0.37, 0.0, -0.93), (0.0, 1.0, 0.0))
DOOR_TOP_QL = ((0.3, 0.2, -0.93), (0.3, 0.9, 0.2))
E2 = {  # (pass A3 round 2, heli-enter with its speed warp: the left foot from the skid lower and straighter onto the
    # doorway's step, the right hand off the handle 0.05 s sooner, the left hand onto the collective from 2 cm higher)
    'viaS': [V3(0.97, 0.76, -1.28)], 'clear': 0.1, 'h_end': 1.40, 'lcv': [V3(0.22, 1.42, -1.30)],
    # (the right hand hanging 6 cm further in while the door swings open, the left hand's grip on the post 0.6 cm
    # further out, the left ball on its pedal 1.5 cm before its plant)
    'hr19': (0.12, -0.10, 0.50), 'lpost': (0.018, 0.0, 0.012), 'lead': {'Left': 0.015},
    # (civilian-m-01-player-ue5 only (_adapt_body), on its seat 0.06 m lower: hips 5 cm lower while the feet carry it,
    # its feet's places 4 cm higher, the trunk pitched back 8 deg at the seat's edge under the doorway's top, the handle
    # let go at 1.36 s and the door's frame at 6.70 s, the left toes up 40 deg over the cyclic onto the pedal, the hips
    # 2.5 cm lower as the left thigh passes the cyclic)
    'ue5_lift': 0.04, 'ue5_dy': 0.05, 'ue5_pitch': -8, 'ue5_hold_end': {'Right 1.03': 1.36, 'Right 6.40': 6.70},
    'ue5_pitch_k': {'Left 5.00': [(0, 0), (0.6, 40), (0.9, 40), (1.0, 30)]}, 'ue5_up': [(6.0, 6.25, 6.6, 6.9, -0.025)],
    'a4_up': [(3.4, 3.55, 3.75, 3.95, 0.015)]}
try:  # (fitting: values tried from a script)
    import bpy as _bpy
    E2.update(_bpy.app.driver_namespace.get('heli_E2', {}))
except ImportError:
    pass


def _rev_steps(plan, T):
    """(pass A2 follow-up 2) A hand or foot plan run backwards: each step's times mapped t -> T - t, in reverse
    order, a move's or a step's via points reversed (a step's pitch curve too)."""
    out = []
    for st in plan:
        a, b = max(st[1], 0.0), min(st[2], T)
        if a >= b:
            continue
        st2 = list(st)
        st2[1], st2[2] = T - b, T - a
        if st[0] in ('step', 'move'):
            st2[4 if st[0] == 'step' else 3] = list(reversed(st[4 if st[0] == 'step' else 3]))
            if st[0] == 'step' and len(st) > 5 and callable(st[5]):
                st2[5] = (lambda f: (lambda x: f(1.0 - x)))(st[5])
        out.append(tuple(st2))
    out = list(reversed(out))
    # (the first and last steps run past the clip's ends, as authored ones do)
    out[0] = (out[0][0], -1.0) + tuple(out[0][2:])
    out[-1] = (out[-1][0], out[-1][1], T + 1.0) + tuple(out[-1][3:])
    return out


def exit2(c):
    """heli-exit (pass A2 follow-up 2), 8.0 s, from heli-collective-down (heli-fly frame 0 with the collective at its
    bottom stop, as on the ground) to standing at entry_cockpit_R facing the helicopter, the door shut: heli-enter's
    checked path run backwards (every channel, hand and foot plan, the door and the balance offsets of heli-enter at
    T - t, T = 8.0 s):
    0.0  hands off the collective and the cyclic (0.3-0.45); right hand to the door's inner frame (1.0), leaning out to the
         right pushes the door from shut to full open (1.0-1.6); the trunk back upright
    1.5  slides forward to the seat's right edge; the left leg lifted back over the cyclic's grip, knee high, to the
         doorway's step (1.9-2.7); the right foot stays in the right footwell
    3.4  turns to the doorway (yaw 196 -> 215 deg), left hand on the seat cushion (4.2-4.4), weight onto the right foot;
         the left foot down onto the skid (4.35-4.7), left hand up onto the doorway's rear post (4.95-5.8)
    4.75 the right leg out of the footwell and down to the ground (4.75-5.45), stepping down off the skid facing the
         helicopter; left hand off the post (5.8-6.25)
    5.7  the door: right hand from the side to its outside handle (6.1-6.55), pushes it shut while stepping back
         (6.55-6.97); two steps back to the entry point, standing, hands at the sides from 7.25."""
    veh = c.veh
    T = 8.0
    ce = Clip('heli-enter', veh, c.author, T, loop=False)
    enter2(ce)
    ce.plan_balance()
    R = lambda f: (lambda t: f(T - t))  # noqa: E731

    def bal(e):
        b = ce._bal
        x = max(0.0, min(len(b) - 1.0, e * 30))
        k = int(x)
        return b[k].lerp(b[min(k + 1, len(b) - 1)], x - k)
    c.join_ref = ce.join_ref
    c.pelvis = lambda t: ce.pelvis(T - t) + bal(T - t)
    c.turn, c.spine, c.look, c.collar = R(ce.turn), R(ce.spine), R(ce.look), R(ce.collar)
    c.poles, c.curl, c.knees = R(ce.poles), R(ce.curl), R(ce.knees)
    c.ctl = {k: (R(v) if callable(v) else v) for k, v in ce.ctl.items()}
    c.finger_pose = ce.finger_pose
    c.hands = {s: _rev_steps(p, T) for s, p in ce.hands.items()}
    c.feet = {s: _rev_steps(p, T) for s, p in ce.feet.items()}
    # (the right hand's move from beside the chest onto the door's frame starts earlier, over 0.4 s: the forearm's
    # twist turns over more frames going this way)
    c.hands['Right'] = [(st[0], st[1], E2.get('xh', 0.9)) + st[3:] if st[0] == 'hold' and abs(st[2] - 1.0) < 1e-6 else
                        (st[0], E2.get('xh', 0.9)) + st[2:] if st[0] == 'move' and abs(st[1] - 1.0) < 1e-6 else st for st in c.hands['Right']]
    ac = {}
    for (side, k), kind in ce.auto_contacts.items():
        n = len(ce.hands[side] if side in ce.hands else ce.feet['Left' if side == 'footLeft' else 'Right'])
        ac[(side, n - 1 - k)] = kind
    c.auto_contacts = ac
    c.root0, c.root1 = ce.root1, ce.root0
    c.balance = False  # (heli-enter's own balance offsets are in the pelvis above)
    c.seat_area, c.seat_pad, c.fixed_roll, c.smooth_runs = ce.seat_area, ce.seat_pad, True, True
    c.seated_before = T - ce.seated_from
    ev = ce.events
    c.events = {'handsOff': T - ev['handsOn'], 'doorOpenStart': T - ev['doorCloseEnd'], 'doorOpenEnd': T - ev['doorCloseStart'],
                'unseated': T - ev['seated'], 'doorCloseStart': T - ev['doorOpenEnd'], 'doorCloseEnd': T - ev['doorOpenStart'],
                'seatedPose': ev['seatedPose']}


EDGE = V3(0.031, 0.499, 1.117)  # the door's rear edge at waist height (door local): pulled shut from behind it
E3 = {  # (pass A3 round 2: civilian-m-01-player-ue5's own values (its seat 0.06 m lower, shorter arms and legs): the
    # right hand onto the glass 5.5 cm lower and 1 cm less pressed, from 0.2 s over 0.55 s; the trunk leaning 8 deg (not
    # 14) to the door; the right foot off its pedal toes up (30 -> 38 -> 0 deg), on the pedal's contact until 1.5 cm off
    # it; its first ground step 8 cm nearer the skid)
    'ue5': {'push_y': 1.42, 'pin': 0.035, 'appr': [V3(0.70, 1.37, -1.30), V3(0.80, 1.43, -1.31)], 'h0': 0.2, 'h1': 0.75,
            's10': 8.0, 'rgnd': (1.48, -1.26), 'rpk': [(0, 30), (0.3, 38), (1.0, 0)], 'trail': {'Left': 0.012, 'Right': 0.015}},
}
try:  # (fitting: values tried from a script)
    import bpy as _bpy
    E3.update(_bpy.app.driver_namespace.get('heli_E3', {}))
except ImportError:
    pass


A4 = {'on': True, 'end': 7.0, 'push_y': 1.47, 'stand': (2.05, -1.27, 95.0), 'r_out': (1.98, -1.12, 95.0), 'l_out': (2.12, -1.42, 95.0)}


def exit_a4_tail(c):
    """(pass A4) heli-exit after both feet are on the ground (5.55, authored): no walk round the door (the brief: "no walk
    round the door"). Two steps out of the open door's swing (right 5.6-5.95, left 5.95-6.35), facing away from the
    helicopter (yaw 110 -> 95), upright and settled by 6.75; the door, clear of the body from 6.0, closes by itself
    (6.0-6.85). `free` at 6.35 (standing clear of the door)."""
    from .clips_car import settle_tail
    end = A4['end']
    st = 0.90
    W0 = 5.55
    sx, sz, yaw = A4['stand']
    c.pelvis = tail(c.pelvis, W0, [(5.95, (1.80, st - 0.03, -1.30)), (6.35, (2.03, st - 0.02, -1.27)), (6.75, (sx, st, sz), 'stop')])
    c.turn = tail(c.turn, W0, [(5.95, (100.0, 2.0, 0.0)), (6.4, (yaw, 0.0, 0.0), 'stop')])
    c.spine = settle_tail(c.spine, 5.6, 6.4, (2.0, 0.0, 0.0))
    c.look = settle_tail(c.look, W0, 6.6, (0.0, 8.0))
    c.collar = settle_tail(c.collar, 5.6, 6.4, (0.0, 0.0, 0.0, 0.0))
    c.curl = settle_tail(c.curl, W0, 6.3, (0.25, 0.25))
    old_door = c.ctl['door']
    door2 = K([(6.0, 1.0, 'stop'), (6.45, 0.72), (6.85, 0.0, 'stop')])
    c.ctl['door'] = lambda t: old_door(t) if t <= 6.0 else door2(t)
    hr = c.hands['Right']
    k = next(i for i, s in enumerate(hr) if s[0] == 'hold' and s[1] <= 3.7 <= s[2])
    c.hands['Right'] = hr[:k] + [hr[k][:2] + (end + 1,) + hr[k][3:]]
    fr, fl = c.feet['Right'], c.feet['Left']
    k = next(i for i, s in enumerate(fr) if s[0] == 'plant' and s[1] >= 4.5)
    c.feet['Right'] = fr[:k + 1] + [('step', fr[k + 1][1], 5.95, 0.08, []), ('plant', 5.95, end + 1, None, *_flat(*A4['r_out'][:2], A4['r_out'][2]))]
    k = next(i for i, s in enumerate(fl) if s[0] == 'plant' and s[3] is None and s[1] >= 5.0)
    c.feet['Left'] = fl[:k] + [fl[k][:2] + (5.95,) + fl[k][3:], ('step', 5.95, 6.35, 0.08, []), ('plant', 6.35, end + 1, None, *_flat(*A4['l_out'][:2], A4['l_out'][2]))]
    old_k = c.knees
    c.knees = lambda t: (lambda k: (k[0], k[1], 1.0 - ease((t - 5.6) / 0.6)))(old_k(t))
    c.root1 = (sx, sz, math.radians(yaw))
    c.events.update({'doorCloseStart': 6.0, 'doorCloseEnd': 6.85, 'free': 6.35})


def _keys_fn(ks):
    """(pass A3 round 2) A step's pitch curve from [x, deg] keys, eased between."""
    ks = tuple(map(tuple, ks))

    def f(x):
        if x <= ks[0][0]:
            return ks[0][1]
        for (xa, pa), (xb, pb) in zip(ks, ks[1:]):
            if x <= xb:
                return pa + (pb - pa) * ease((x - xa) / (xb - xa))
        return ks[-1][1]
    return f


def exit3(c):
    """heli-exit (pass A3), its own move, from heli-collective-down (the collective at its bottom stop):
    0.3  right hand off the cyclic onto the door's inside under the window (0.8), pushes it open to 25 % (1.2); it swings
         to its full 68 deg (2.0); left hand off the collective to the side
    1.3  right foot off its pedal, through the footwell to the doorway's step (1.8); the hips slide to the seat's right
         edge, turning out to the door
    1.9  the left leg lifted back over the cyclic's grip, knee high and out, onto the doorway's step (2.8); facing out
    2.4  right hand to the doorway's rear post (2.7), left hand on the cushion (3.0-3.6): leaning forward out of the
         seat under the frame, the left foot down onto the skid (3.6-4.1), the right foot past the skid to the ground
         (4.1-4.7), the left off the skid to the ground (5.0-5.5); right hand off the post (4.9)
    5.6  turns to the open door; right hand on its rear edge (6.1); walking backwards round its swing pulls it shut,
         lets go at 15 % (7.6) and it shuts (7.9); a step back, standing clear, hands at the sides from 8.6."""
    veh = c.veh
    cd = _down_pose(veh, c.author)
    c.join_ref = 'heli-collective-down'
    W0, WS = 5.55, E3.get('walk_stretch', 1.3)
    RT = lambda t: t if t <= W0 else W0 + (t - W0) * WS  # noqa: E731  (the walk round the door, stretched: longer steps)
    KK = lambda ks: K([(RT(k[0]),) + tuple(k[1:]) for k in ks])  # noqa: E731
    P = lambda *k: KK(list(k))  # noqa: E731
    pe, tu, sp = tuple(cd.pelvis(0.0)), tuple(cd.turn(0.0)), tuple(cd.spine(0.0))
    st = 0.90
    end = c.seconds
    sx, sy = SKID
    E = E3
    c.pelvis = P((0.0, pe, 'stop'), (0.5, pe, 'stop'), (1.0, (0.44, 1.33, -1.28)), (1.8, (0.52, 1.365, -1.29)), (2.4, (0.60, 1.375, -1.30)),
                 (2.9, (0.64, 1.39, -1.31), 'stop'), (3.4, (0.70, 1.36, -1.34)), (3.9, (0.94, 1.00, -1.44)), (4.3, (1.06, 0.96, -1.42)),
                 (4.7, (1.28, 0.86, -1.38)), (5.1, (1.45, 0.86, -1.42)), (5.55, (1.60, st - 0.04, -1.43)),
                 (5.95, (1.82, st - 0.10, -1.22)), (6.35, (2.12, st - 0.12, -1.15)), (6.75, (2.34, st - 0.13, -1.73)), (7.25, (2.12, st - 0.12, -2.10)),
                 (7.55, (1.90, st - 0.13, -2.05)), (7.95, (1.60, st - 0.10, -1.68)), (8.3, (1.42, st - 0.10, -1.60), 'stop'), (8.75, (1.60, st - 0.03, -1.58)),
                 (9.2, (1.78, st, -1.55), 'stop'))
    c.turn = P((0.0, tu, 'stop'), (0.5, tu, 'stop'), (1.0, (182.0, 2.0, 10.0)), (1.6, (180.0, 0.0, 2.0)), (2.2, (150.0, 4.0, 0.0)),
               (2.9, (110.0, 14.0, 0.0), 'stop'), (3.4, (100.0, 24.0, 0.0)), (3.9, (96.0, 20.0, 0.0)), (4.6, (100.0, 10.0, 0.0)),
               (5.55, (110.0, 2.0, 0.0)), (5.95, (150.0, 2.0, 0.0)), (6.35, (185.0, 2.0, 0.0)),
               (6.75, (250.0, 2.0, 0.0)), (7.15, (330.0, 6.0, 0.0)), (7.55, (305.0, 8.0, 0.0)), (7.95, (285.0, 10.0, 0.0)), (8.3, (268.0, 12.0, 0.0), 'stop'),
               (9.2, (268.0, 0.0, 0.0), 'stop'))
    c.spine = P((0.0, sp, 'stop'), (0.5, sp, 'stop'), (1.0, (sp[0] + 4.0, 0.0, E3.get('s10', 14.0))), (1.6, (14.0, 0.0, 0.0)), (2.9, (16.0, 0.0, 0.0), 'stop'),
                (3.4, (22.0, 0.0, 0.0)), (3.9, (20.0, 0.0, 0.0)), (4.6, (10.0, 0.0, 0.0)), (5.6, (4.0, 0.0, 0.0)),
                (7.2, (8.0, 0.0, 0.0)), (8.3, (12.0, 0.0, 0.0)), (9.0, (2.0, 0.0, 0.0), 'stop'))
    c.look = P((0.0, tuple(cd.look(0.0)), 'stop'), (0.6, (-30.0, 0.0)), (1.2, (-20.0, 10.0)), (2.2, (0.0, 30.0)), (3.4, (0.0, 35.0)),
               (4.2, (0.0, 30.0)), (5.2, (10.0, 15.0)), (6.0, (-20.0, 10.0)), (7.0, (-30.0, 10.0)), (8.0, (-10.0, 8.0)), (8.8, (0.0, 8.0), 'stop'))
    c.collar = P((0.0, tuple(cd.collar(0.0)), 'stop'), (0.3, tuple(cd.collar(0.0)), 'stop'), (0.8, (0.0, 0.0, 6.0, 6.0)), (1.6, (0.0, 0.0, 0.0, 0.0)), (2.7, (0.0, 0.0, 8.0, 10.0)),
                 (4.4, (0.0, 0.0, 6.0, 6.0)), (5.6, (0.0, 0.0, 0.0, 0.0)), (7.2, (0.0, 0.0, 6.0, 6.0)), (8.3, (0.0, 0.0, 8.0, 8.0)),
                 (9.0, (0.0, 0.0, 0.0, 0.0), 'stop'))
    pref = cd.poles(0.0)
    c.poles = lambda t: (Vector(pref[0]).lerp(V3(0.7, -0.8, -0.2), ease((t - 0.3) / 0.6)), Vector(pref[1]).lerp(V3(-0.7, -0.8, -0.2), ease((t - 0.3) / 0.6)))
    c.ctl = {'door': KK([(0.0, 0.0), (0.8, 0.0, 'stop'), (1.25, 0.28), (2.0, 1.0, 'stop'), (7.3, 1.0, 'stop'), (7.6, 0.7), (7.95, 0.2), (8.3, 0.0, 'stop')]),
             'fwd': 0.0, 'right': 0.0, 'coll': vehicles.COLLECTIVE_DEG['down'], 'pedal': 0.0}
    c.curl = KK([(0.0, (1.0, 1.0)), (0.05, (1.0, 1.0)), (0.3, (0.1, E3.get('c03', 0.3))), (0.55, (0.25, 0.0)), (0.8, (0.3, 0.0)), (1.3, (0.3, 0.0)), (1.6, (0.3, 0.0)), (1.8, (0.3, 0.3)), (2.4, (0.3, 0.3)),
                (2.7, (0.3, 0.8)), (3.4, (0.3, 0.8)), (3.6, (0.3, 0.3)), (6.9, (0.3, 0.3)), (7.2, (0.3, 0.05)), (8.3, (0.3, 0.05)), (8.6, (0.3, 0.25)), (9.0, (0.25, 0.25), 'stop')])
    c.finger_pose = wheel_grip(c.author.fingers)
    di = veh.to_local('cockpit_door_R', V3(0.888, E.get('push_y', 1.497), -1.327), {'door': 0.0})
    dn = (veh.world('cockpit_door_R', {'door': 0.0}).to_3x3().inverted() @ V3(1, 0, 0)).normalized()
    dz = (veh.world('cockpit_door_R', {'door': 0.0}).to_3x3().inverted() @ V3(0, 0, 1)).normalized()
    up_l = (veh.world('cockpit_door_R', {'door': 0.0}).to_3x3().inverted() @ V3(0, 1, 0)).normalized()
    m32 = veh.world('cockpit_door_R', {'door': 0.33})
    off1 = m32 @ (di - dn * 0.025) - (m32.to_3x3() @ dn).normalized() * 0.09  # (straight back off the glass as it swings out)
    pp = _door_local(veh, HANDLE + V3(0.0, 0.06, 0.0)) - dz * 0.40 + dn * 0.03  # (the outer face beside the handle, pushed shut)
    seat_up = (veh.world('pilot_seat', {}).to_3x3().inverted() @ V3(0, 1, 0)).normalized()
    c.hands = {
        'Right': [('hold', -1.0, E3.get('h0', 0.3), *cd.hands['Right'][0][3:]), ('move', E3.get('h0', 0.3), E3.get('h1', 0.6), E3.get('appr', [V3(0.70, 1.40, -1.30), V3(0.80, 1.47, -1.31)]), 0.0),
                  ('hold', E3.get('h1', 0.6), 1.3, 'cockpit_door_R_glass', di - dn * E3.get('pin', 0.045), _door_q(veh, hq(*E.get('dq', ((0.77, 0.17, 0.62), (0.38, -0.92, -0.05))))), di - dn * 0.025, dn, 70),
                  ('move', 1.3, 1.75, [off1, V3(0.74, 1.45, -1.32)], 0.0), ('hold', 1.75, 3.2, *hang('Right', 0.20, 0.02, 0.42)), ('move', 3.2, 3.6, [], 0.0),
                  ('hold', 3.6, 6.85, *hang('Right', 0.12, 0.04, 0.50)), ('move', 6.85, 7.3, [], 0.0),
                  ('hold', 7.3, 7.8, 'cockpit_door_R', pp, _door_q(veh, hq(*E.get('pushqa', ((-0.70, -0.62, 0.36), (0.0, 0.85, -0.53))))), pp - dn * 0.01, dn, 90),
                  ('move', 7.8, 7.92, [], 0.0),
                  ('hold', 7.92, 8.3, 'cockpit_door_R', pp, _door_q(veh, hq(*E.get('pushq', ((-0.88, -0.35, -0.33), (0.0, 0.7, 0.7))))), pp - dn * 0.01, dn, 50),
                  ('move', 8.3, 8.7, [], 0.0), ('hold', 8.7, end + 1, *hang('Right'))],
        'Left': [('hold', -1.0, 0.3, *cd.hands['Left'][0][3:]), ('move', 0.3, 1.0, [V3(0.17, 1.40, -1.30), V3(0.34, 1.50, -1.38)], 0.0),
                 ('hold', 1.0, 2.65, *hang('Left', 0.06, 0.07, 0.42)), ('move', 2.65, 3.0, [], 0.0),
                 ('hold', 3.0, 3.4, 'fuselage', FRONT_POST, hq(*E.get('fpq', ((-0.56, 0.32, -0.77), (0.87, -0.5, 0.0)))), FRONT_POST, V3(0, 1, 0), 60),
                 ('move', 3.4, 4.0, [], 0.0), ('hold', 4.0, end + 1, *hang('Left'))],
    }
    c.auto_contacts = {('Right', 0): 'grip', ('Right', 2): 'push', ('Right', 8): 'push', ('Right', 10): 'push',
                       ('Left', 0): 'grip', ('Left', 4): 'grip'}
    fl, fr = cd.feet['Left'][0], cd.feet['Right'][0]
    c.feet = {
        'Right': [('plant', -1.0, 1.3) + fr[3:],
                  ('step', 1.3, 1.85, 0.07, [V3(0.62, 0.95, -1.70), V3(0.72, 0.95, -1.52)]) + ((_keys_fn(E3['rpk']),) if E3.get('rpk') else ()),
                  ('plant', 1.85, 4.17, None, *_flat(0.75, -1.40, 120.0, 0.83)),
                  ('step', 4.17, 4.75, 0.04, [V3(0.98, 0.80, -1.34), V3(1.20, 0.42, -1.28)]),
                  ('plant', 4.75, 5.6, None, *_flat(*E3.get('rgnd', (1.55, -1.24)), 100.0)), ('step', 5.6, 5.95, 0.08, []),
                  ('plant', 5.95, 6.37, None, *_flat(2.02, -0.98, 150.0)), ('step', 6.37, 6.88, 0.08, []),
                  ('plant', 6.88, 7.34, None, *_flat(2.40, -2.08, 240.0)), ('step', 7.34, 7.62, 0.08, []),
                  ('plant', 7.62, 8.0, None, *_flat(1.80, -1.75, 300.0)), ('step', 8.0, 8.3, 0.08, []),
                  ('plant', 8.3, 8.4, None, *_flat(1.38, -1.78, 265.0)), ('step', 8.4, 8.75, 0.08, []),
                  ('plant', 8.75, end + 1, None, *_flat(1.76, -1.72, 270.0))],
        'Left': [('plant', -1.0, 1.65) + fl[3:],
                 ('step', 1.65, 3.0, 0.05, E.get('viaL', [V3(0.22, 1.15, -1.80), V3(0.27, 1.58, -1.77), V3(0.36, 1.74, -1.72), V3(0.47, 1.77, -1.68), V3(0.58, 1.69, -1.64), V3(0.68, 1.45, -1.63), V3(0.74, 1.15, -1.64)])),
                 ('plant', 3.0, 3.6, None, *_flat(0.78, -1.64, 95.0, 0.84)),
                 ('step', 3.6, 4.15, 0.03, [V3(0.98, 0.80, -1.58)]),
                 ('plant', 4.15, 5.0, 'skid_R', *_flat(sx, -1.60, 95.0, sy)),
                 ('step', 5.0, 5.55, 0.04, [V3(1.40, 0.30, -1.58)]),
                 ('plant', 5.55, 6.0, None, *_flat(1.66, -1.62, 110.0)), ('step', 6.0, 6.35, 0.08, []),
                 ('plant', 6.35, 6.9, None, *_flat(2.32, -1.38, 190.0)), ('step', 6.88, 7.32, 0.08, []),
                 ('plant', 7.32, 7.6, None, *_flat(1.98, -2.32, 320.0)), ('step', 7.6, 7.95, 0.08, []),
                 ('plant', 7.95, 8.8, None, *_flat(1.48, -1.44, 272.0)), ('step', 8.8, 9.15, 0.08, []),
                 ('plant', 9.15, end + 1, None, *_flat(1.80, -1.40, 270.0))],
    }
    rt = lambda st: (st[0], RT(st[1]), RT(st[2])) + tuple(st[3:])  # noqa: E731
    c.hands = {k: [rt(st) for st in v] for k, v in c.hands.items()}
    c.feet = {k: [rt(st) for st in v] for k, v in c.feet.items()}
    c.auto_contacts.update({('footLeft', 0): 'press', ('footRight', 0): 'press', ('footRight', 2): 'step', ('footLeft', 2): 'step',
                            ('footLeft', 4): 'step'})

    def knees(t):
        kl = V3(-0.6, 0.6, -0.4).lerp(V3(0.0, 1.0, -0.3), ease((t - 2.3) / 0.5))
        kr = V3(0.0, 1.0, -0.3)
        w = _bumpk(t, 0.9, 1.3, 7.0, 7.5)
        k0 = cd.knees(0.0)
        return (Vector(k0[0]).lerp(kl, w), Vector(k0[1]).lerp(kr, w), 1.0)
    c.knees = knees
    seat_r = veh.world('seat_pilot_point').translation
    c.root0, c.root1 = (seat_r.x, seat_r.z, math.pi), (1.78, -1.55, math.radians(268.0))
    c.balance, c.seat_area, c.seat_pad, c.fixed_roll, c.smooth_runs = True, SEAT_AREA, SEAT_PAD, True, True
    c.seated_before = 1.6
    c.balance_skip = ((3.3, 99.0),)  # (stepping down held by the left hand on the front post; then the walk round the door)  # (stepping down out of the doorway held by the right hand on the post)
    c.step_clear = 0.15
    c.contact_trail = E3.get('trail', {'Left': 0.012, 'Right': 0.012})
    c.events = {'handsOff': 0.3, 'doorOpenStart': 0.8, 'doorOpenEnd': 2.0, 'unseated': 3.4, 'doorCloseStart': RT(7.2), 'doorCloseEnd': RT(8.3),
                'seatedPose': 'heli-collective-down'}
