"""The supercar's clips (vehicle frame V of `vehicle_root`: forward -Z, the driver on the left, -X).

Fitted to the car's real geometry (numbers from the GLB, pass A1):
  seat_driver cushion top y 0.27 to 0.29 over z -0.25..+0.10; backrest face from (y 0.30, z 0.19) to
  (y 0.95, z 0.39), 17 degrees back; headliner y 1.06 to 1.09 over the seat; floor y 0.165; sill top
  y 0.315 from x -0.935 (outside) to -0.775 (inside), the door opening z -0.65..+0.25 at the sill;
  steering wheel centre (-0.37, 0.665, -0.50), column glTF local +Y (towards the driver, up 22 deg),
  12 o'clock = local -Z, 3 o'clock = local +X; door_L hinged at (-0.872, 0.80, -1.12), opens up (55 deg).
"""
import math

from mathutils import Quaternion, Vector

from rifle_motion.gait import foot

from rifle_motion.handling import ease

from .pose import Clip, K, V3, const, ground_for_ball, hq, sole_points, warp_of, wheel_grip

DEG = math.pi / 180
SEAT_ROOT = (-0.37, 0.06, math.pi)  # seat_driver_point on the ground plane, facing forward (-Z)
ENTRY_ROOT = (-1.55, -0.25, math.pi)  # entry_driver_point (identity: faces the car's forward)
GRIP_UP = 0.45  # how far the fingers are tipped towards 12 o'clock (wrist deviation)
LOOK_BACK_AT = (-0.26, 0.78, 0.27)  # the passenger backrest's inner top corner (seat_passenger frame)
RIM_OUT, RIM_BACK = 0.022, 0.036  # the palm's middle off the rim's centre line: outwards, towards the driver (the rim under the fingers' roots)
RIM = 0.172  # m, the rim's centre line from the wheel's centre (fitted on the mesh)

# ---------------------------------------------------------------- the seated pose (the reference)
SEATED = dict(
    # (fitted, pass A1 follow-up, with the vehicle fit (fit.py): seat 0.20 m forward and 0.03 m down, wheel
    # 0.06 m out along its column. The back lies on the backrest (shoulder blades in the bucket's upper
    # wings), the hips 6 cm forward of its foot and tipped back 42 deg (a low car's slouch: with the trunk at
    # the backrest's own 17 deg the head stands 4 to 6 cm through the headliner), chin 20 deg down.)
    pelvis=V3(-0.37, 0.372, -0.215),
    turn=V3(180.0, -42.0, 0.0),  # yaw, pitch (tipped back), roll
    spine=V3(4.0, 0.0, 0.0),
    look=V3(0.0, 20.0),
    collar=V3(-22.0, 0.0, 22.0, 0.0),
    poles=(V3(0.8, -0.8, -0.1), V3(-0.8, -0.8, -0.1)),
    # feet by the sole under the ball: the right on the accelerator's face (x -0.30..-0.25, z -1.045, y
    # 0.20..0.31), the left on the floor beside the brake (x -0.56..-0.47)
    ball_l=(V3(-0.48, 0.235, -1.085), 200.0, 12.0),  # (behind the brake pedal, clear of the wheel arch)
    ball_r=(V3(-0.275, 0.29, -1.05), 176.0, 38.0),
)


# the steering poses (car-steer-l / -r), fitted for reach and the wrists (pass A1)
STEER = dict(chin=16.0, up_low=-0.4, lean=5.0, twist=15.0, side=-3.0, collar_up=44.0, collar_low=20.0, roll_up=0.0, roll_low=0.0,
             pole_up=(0.8, -0.6, -0.1), pole_low=(0.5, -1.0, -0.1))


# where the knees point (V): both leaned towards the driver's left, the right knee off the centre console
KNEES = None
# per body (the EarthOnline bodies' head and hair stand 2 cm higher than Tripo's in this pose)
# (pass A3 follow-up, Tripo: the shoulders carried forward and down off the bucket's wings (collar); the right knee's pole
# steered left off the centre tunnel (the left at its rest pole: per-side weights))
SEATED_BY_BODY_A3 = {'tripo-player-ue5': dict(collar=V3(-16.0, 28.0, 16.0, 28.0), knees=(V3(0.0, 1.0, 0.0), V3(-0.6, 0.8, -0.3)), knees_w=(0.0, 1.0))}
SEATED_BY_BODY = {'civilian-m-01-player-ue5': dict(pelvis=V3(-0.37, 0.35, -0.19), turn=V3(180.0, -38.0, 0.0), look=V3(0.0, 18.0),
                                                  ball_l=(V3(-0.465, 0.235, -1.03), 204.0, 14.0))}


def rim_grip(clock_deg, side, roll=0.0, up=None, axis_out=False):
    """(at, quat) of a palm on the rim at `clock_deg` (0 = 12 o'clock, 90 = 3, 270 = 9), wheel frame;
    `roll` turns the hand round the rim's tube (degrees, about the rim's tangent: the hand rolls on the
    rim as the wheel turns, the wrist kept in its range)."""
    a = math.radians(clock_deg)
    out_dir = Vector((math.sin(a), 0.0, -math.cos(a)))  # from the centre to the rim point
    # along the rim towards the thumb (the left hand's thumb leads clockwise as the driver sees it at 9)
    tangent_up = Vector((math.cos(a), 0.0, math.sin(a))) * (1 if side == 'Left' else -1)
    at = out_dir * (RIM + RIM_OUT) + Vector((0, RIM_BACK, 0))
    palm = -out_dir  # the palm faces the wheel's centre, fingers forward round the rim
    # fingers forward round the rim, tipped up towards the thumb (the forearm rises to the wheel)
    q = hq(palm * 0.95 + Vector((0, -0.3, 0)), Vector((0, -1, 0)) + tangent_up * (GRIP_UP if up is None else up))
    if roll:
        axis = Vector((math.cos(a), 0.0, math.sin(a)))
        turn = Quaternion(axis, math.radians(roll))
        centre = out_dir * RIM
        at = centre + turn @ (at - centre)
        q = (turn @ q).normalized()
    if axis_out:
        # (with the rim's tube for pose.Clip.roll_on_handles: the hand may roll round it 30 deg for its wrist)
        return at, q, out_dir * RIM, Vector((math.cos(a), 0.0, math.sin(a))), 30
    return at, q


def seat_root(veh):
    """The seated root: seat_driver_point (moved with the seat by the vehicle fit) on the ground plane."""
    p = veh.world('seat_driver_point').translation
    return (p.x, p.z, math.pi)


def _seated_s():
    """(pass A2 follow-up 2) SEATED with the body's own entries (SEATED_BY_BODY), as seated() takes them: the enter
    and exit clips end and start on the body's own car-drive frame 0."""
    s = dict(SEATED)
    from rifle_motion import body as body_table
    s.update(SEATED_BY_BODY.get(body_table.T.get('name'), {}))
    s.update(SEATED_BY_BODY_A3.get(body_table.T.get('name'), {}))
    return s


UE5 = {  # (pass A3 follow-up: car-enter fitted for civilian-m-01-player-ue5; keys 'Side t0' name a step of the plan)
    'vias': {'Left 6.85': [(-0.41, 0.28, -0.80)],  # (its shorter foot: the last step ends 5 cm further back)
             'Right 5.00': [(-1.24, 0.43, -0.10), (-1.04, 0.49, -0.20), (-0.80, 0.39, -0.34), (-0.50, 0.27, -0.52), (-0.34, 0.27, -0.78)]},
    'pitch': {'Right 5.00': (0.0, 38.0, 0.1, 0.45), 'Left 5.60': (-20.0, 10.0, 0.0, 0.7)},  # (toes up early: the ball over the floor's rise)
    'lead': {'Right': 0.015},  # (the right ball on the pedal 1.5 cm before its plant)
    'kb0': 5.0, 'kr1': (0.5, 0.2, -0.8),  # (the right knee down and out under the rim as the leg comes in)
    'e0': 6.6,  # (the hips back to the plan's own height from 6.6 s)
}
UE5['vias'].update({  # (car-exit: its own last step backwards off the floor; the right foot higher over the sill)
    'Left 1.40': [(-0.41, 0.28, -0.80)],
    'Right 3.25': [(-0.48, 0.32, -0.72), (-0.70, 0.34, -0.625), (-0.92, 0.47, -0.43), (-1.08, 0.53, -0.24), (-1.20, 0.33, -0.12)]})
UE5['pitch'].update({'Right 3.25': [(0.0, 0.0), (0.2, 25.0), (0.75, 20.0), (1.0, 0.0)]})  # (toes up over the sill)
UE5.update({
    'xw': 0.3,  # (car-exit: the hips 30 % of dy lower while seated, not 100 %: the back off the seat's wing)
    'hand_vias': {'Left 1.00': [(-0.48, 0.58, -0.32)]},  # (the left hand from the door to the thigh, in front of the wing)
    'EX': {  # (car-exit's middle (exit_middle) for this body: its broader back under the roof's edge)
        'hang_r2': (3.9, 4.25, (0.07, 0.14, 0.50)), 'r0': 1.65,
        't': [(1.5, (182.0, -41.0, -4.0)), (2.0, (192.0, -40.0, -8.0)), (2.5, (196.0, -36.0, -8.0)), (3.0, (200.0, -18.0, -6.0)), (3.5, (245.0, 6.0, -6.0))],
        's': [(1.5, (4.0, 10.0, -12.0)), (2.0, (5.0, 16.0, -22.0)), (2.6, (6.0, 22.0, -30.0)), (3.2, (16.0, 16.0, -26.0)), (3.6, (17.0, 4.0, -16.0))],
        'p': [(1.6, (-0.40, 0.372, -0.21)), (1.9, (-0.45, 0.39, -0.20)), (2.3, (-0.50, 0.42, -0.19)), (3.0, (-0.58, 0.48, -0.13)), (3.4, (-0.66, 0.50, -0.12)),
              (3.8, (-0.80, 0.50, -0.13))]},
})
try:  # (fitting: values tried from a script)
    import bpy as _bpy
    UE5.update(_bpy.app.driver_namespace.get('car_UE5', {}))
except ImportError:
    pass


def _ue5():
    """UE5 when the body being built is civilian-m-01-player-ue5, else {} (Tripo's clips never read it)."""
    from rifle_motion import body as body_table
    return UE5 if body_table.T.get('name') == 'civilian-m-01-player-ue5' else {}


def _adapt_body(c, w):
    """(pass A3) The car's entry / exit plans retargeted to the EarthOnline bodies (civilian-m-01-player-ue5 and the
    roster on its joints): legs 0.78 m against Tripo's 0.82 and a seat pose 2.2 cm lower, so the hips go `dy` lower while
    the plan is Tripo's (w = 1), easing to the plan's own heights where it joins the seated reference (w = 0). Tripo's
    clips are unchanged."""
    from rifle_motion import body as body_table
    if body_table.T.get('name') != 'civilian-m-01-player-ue5':
        return
    dy, pel = UE5.get('dy', 0.035), c.pelvis
    c.pelvis = lambda t: pel(t) - V3(0.0, dy * w(t), 0.0)
    # (its feet are longer: the footwell's places and the way over the sill a little higher, but not the seated end)
    lift = UE5.get('lift', 0.02)
    if UE5.get('lead'):  # (a foot on its contact a little before its plant: the ball meeting the pedal)
        c.contact_lead = dict(getattr(c, 'contact_lead', {}), **UE5['lead'])
    for side, plan in c.hands.items():  # (a hand move's own way for this body: 'Side t0' -> vias)
        if UE5.get('debug'):
            print('UE5 hands', side, [(st[0], round(st[1], 3), round(st[2], 3)) for st in plan])
        for k, st in enumerate(plan):
            own = UE5.get('hand_vias', {}).get('%s %.2f' % (side, st[1])) if st[0] == 'move' else None
            if own:
                plan[k] = st[:3] + ([Vector(v) for v in own],) + st[4:]
            at = UE5.get('hand_at', {}).get('%s %.2f' % (side, st[1])) if st[0] == 'hold' else None
            if at:  # (a hold's own place for this body, same node and turn)
                plan[k] = st[:4] + (Vector(at),) + st[5:]
    for side, plan in c.feet.items():
        n = len(plan)
        if UE5.get('debug'):
            print('UE5 plan', c.name if hasattr(c, 'name') else '', side, [(st[0], round(st[1], 3), round(st[2], 3), st[3] if st[0] != 'step' else len(st[4])) for st in plan])
        for k, st in enumerate(plan):
            if st[0] == 'plant' and st[3] == 'interior' and 0 < k < n - 1:
                plan[k] = st[:4] + (Vector(st[4]) + V3(0.0, lift, 0.0),) + st[5:]
            elif st[0] == 'step':
                own = UE5.get('vias', {}).get('%s %.2f' % (side, st[1]))  # (a step's own way for this body)
                if own:
                    plan[k] = st[:4] + ([Vector(v) for v in own],) + st[5:]
                elif st[4]:
                    plan[k] = st[:4] + ([Vector(v) + V3(0.0, UE5.get('vlift', 0.03), 0.0) for v in st[4]],) + st[5:]
            pf = UE5.get('pitch', {}).get('%s %.2f' % (side, st[1])) if st[0] == 'step' else None
            if pf:  # (a step's own pitch curve for this body: to `p` deg over the first `d` of the step)
                if isinstance(pf[0], (list, tuple)):  # ([x, deg] keys, eased between)
                    def _pk(x, ks=tuple(map(tuple, pf))):
                        if x <= ks[0][0]:
                            return ks[0][1]
                        for (xa, pa), (xb, pb) in zip(ks, ks[1:]):
                            if x <= xb:
                                return pa + (pb - pa) * ease((x - xa) / (xb - xa))
                        return ks[-1][1]
                    plan[k] = plan[k][:5] + (_pk,)
                elif len(pf) == 2:
                    plan[k] = plan[k][:5] + ((lambda p, d: (lambda x: p * ease(x / d)))(*pf),)
                else:  # (from p0 to p1 between x0 and x1 of the step)
                    plan[k] = plan[k][:5] + ((lambda p0, p1, x0, x1: (lambda x: p0 + (p1 - p0) * ease((x - x0) / (x1 - x0))))(*pf),)


def seated(c, wheel=0.0):
    """Sets the clip's channels to the seated pose (hands at 9 and 3)."""
    s = dict(SEATED)
    from rifle_motion import body as body_table
    s.update(SEATED_BY_BODY.get(body_table.T.get('name'), {}))
    s.update(SEATED_BY_BODY_A3.get(body_table.T.get('name'), {}))
    try:  # (fitting: values tried from a script, bpy.app.driver_namespace['car_fit'])
        import bpy
        s.update(bpy.app.driver_namespace.get('car_fit', {}))
    except ImportError:
        pass
    c.pelvis = const(s['pelvis'])
    c.turn = const(s['turn'])
    c.spine = const(s['spine'])
    c.look = const(s['look'])
    c.collar = const(s['collar'])
    c.poles = K([(0.0, (tuple(s['poles'][0]), tuple(s['poles'][1])))]) if False else (lambda t: s['poles'])
    c.curl = const((1.0, 1.0))
    c.ctl = {'door': 0.0, 'wheel': wheel}
    seat = seat_root(c.veh)
    c.root = lambda t: seat
    c.finger_pose = wheel_grip(c.author.fingers)
    if s.get('knees', KNEES) is not None:
        kl, kr = s.get('knees', KNEES)
        kw = s.get('knees_w')  # (pass A3: per side, 0 = the pole at its rest on the foot)
        c.knees = (lambda t: (kl, kr)) if kw is None else (lambda t: (kl, kr, kw))
    T = c.seconds + 1
    c.hands = {'Left': [('hold', 0.0, T, 'steering_wheel', *rim_grip(270, 'Left'))],
               'Right': [('hold', 0.0, T, 'steering_wheel', *rim_grip(90, 'Right'))]}
    fl = (ground_for_ball(s['ball_l'][0], s['ball_l'][1], s['ball_l'][2]), s['ball_l'][1], s['ball_l'][2])
    fr = (ground_for_ball(s['ball_r'][0], s['ball_r'][1], s['ball_r'][2]), s['ball_r'][1], s['ball_r'][2])
    c.feet = {'Left': [('plant', 0.0, T, None, *fl)], 'Right': [('plant', 0.0, T, None, *fr)]}


def contacts_seated(c):
    n = c.n - 1
    out = []
    for side, s in (('Left', 'l'), ('Right', 'r')):
        g, yaw, pitch = c.feet[side][0][4:7]
        ball = sole_points(g, yaw, pitch)[1]
        out.append(dict(part='foot_' + s, **{'from': 0}, to=n, node='interior', at=[round(x, 4) for x in ball], kind='press' if s == 'r' else 'rest', point='ball'))
    for side, s in (('Left', 'l'), ('Right', 'r')):
        step = c.hands[side][0]
        out.append(dict(part='hand_' + s, **{'from': 0}, to=n, node='steering_wheel', at=[round(x, 4) for x in step[4]], kind='grip'))
    return out


def make(name, veh, author):
    if name == 'car-drive':
        c = Clip(name, veh, author, 8.0, loop=True)
        seated(c)
        c.alive = drive_life
        c.ctl['wheel'] = lambda t: 2.5 * math.sin(2 * math.pi * t / 8.0) + 1.2 * math.sin(2 * math.pi * 3 * t / 8.0 + 0.7) - 1.2 * math.sin(0.7)
        # grip adjustments: the fingers ease off the rim and close again, one hand at a time
        c.curl = lambda t: (1.0 - 0.3 * _bump(t, 5.9, 6.6), 1.0 - 0.35 * _bump(t, 3.5, 4.3))
        c.contacts = contacts_seated(c)
        c.events = {'handsOn': 0.0, 'seated': 0.0}
        return c
    if name == 'car-enter':
        c = Clip(name, veh, author, 8.0, loop=False)
        enter(c)
        _adapt_body(c, lambda t: (1.0 - ease((t - 4.3) / 0.4)) + ease((t - 5.9) / 0.5) * (1.0 - ease((t - UE5.get('e0', 7.0)) / UE5.get('e1', 0.7))))
        c.warp = warp_of(c)  # (pass A3 round 2: the speed-limited time warp, warps_a3.json)
        return c
    if name == 'car-exit':
        c = Clip(name, veh, author, 7.8, loop=False)
        keep = dict(EX)
        EX.update(_ue5().get('EX', {}))  # (the EarthOnline body's own values for the middle; none for Tripo)
        exit_(c)
        if EX.get('on'):  # (pass A3 follow-up: the own middle, exit_middle())
            exit_middle(c)
        EX.clear()
        EX.update(keep)
        xw = _ue5().get('xw', 1.0)
        _adapt_body(c, lambda t: xw * ease((t - 0.3) / 0.7) * (1.0 - ease((t - 2.4) / 0.4)) + ease((t - 4.1) / 0.5))
        c.warp = warp_of(c)
        return c
    if name == 'car-seated':  # (fitting only: the reference pose, one frame)
        c = Clip(name, veh, author, 0.0, loop=False)
        seated(c)
        c.contacts = contacts_seated(c)
        return c
    if name in ('car-steer-l', 'car-steer-r'):
        c = Clip(name, veh, author, 0.0, loop=False)
        wheel = 90.0 if name.endswith('-l') else -90.0
        seated(c, wheel)
        sgn = 1 if wheel > 0 else -1
        st = dict(STEER)
        try:
            import bpy
            st.update(bpy.app.driver_namespace.get('steer_fit', {}))
        except ImportError:
            pass
        # the chest leans a little forward and into the turn, the top hand's shoulder comes forward;
        # each hand rolls on the rim (STEER, fitted for the wrists); mirrored for the other way
        up, low = ('Right', 'Left') if sgn > 0 else ('Left', 'Right')
        c.spine = const(SEATED['spine'] + V3(st['lean'], st['twist'] * sgn, st['side'] * sgn))
        c.look = const(SEATED['look'] + V3(10.0 * sgn, st['chin']))
        cu, cl = st['collar_up'], st['collar_low']
        col = {'Left': (cu if up == 'Left' else cl), 'Right': (cu if up == 'Right' else cl)}
        c.collar = const(V3(-col['Left'], 0.0, col['Right'], 0.0))
        c.hands[up] = [('hold', 0.0, 1.0, 'steering_wheel', *rim_grip(270 if up == 'Left' else 90, up, st['roll_up'] * (1 if up == 'Right' else -1)))]
        c.hands[low] = [('hold', 0.0, 1.0, 'steering_wheel', *rim_grip(270 if low == 'Left' else 90, low, st['roll_low'] * (1 if low == 'Right' else -1), st['up_low']))]
        pu, pl = st['pole_up'], st['pole_low']
        mir = lambda v, s: V3(v[0] * (1 if s == 'Left' else -1), v[1], v[2])  # noqa: E731
        poles = {up: mir(pu, up), low: mir(pl, low)}
        c.poles = lambda t: (poles['Left'], poles['Right'])
        c.contacts = contacts_seated(c)
        c.events = {'handsOn': 0.0, 'seated': 0.0}
        return c
    if name == 'car-look-back':
        c = Clip(name, veh, author, 0.0, loop=False)
        seated(c)
        # turned to look out of the back over the right shoulder, the right hand off the wheel onto the
        # passenger seat's shoulder, the left hand on top of the wheel
        c.spine = const(V3(-4.0, -38.0, 4.0))
        c.turn = const(SEATED['turn'] + V3(-8.0, 2.0, -3.0))
        c.look = const(V3(-120.0, 6.0))
        c.collar = const(V3(-10.0, 0.0, 14.0, 2.0))
        c.hands['Left'] = [('hold', 0.0, 1.0, 'steering_wheel', *rim_grip(335, 'Left', 0.0, 0.2, axis_out=True))]
        # (the right arm over the passenger backrest was tried: the twisted upper arm went into the driver's
        # own seat and the wrist bent 63 deg; it rests on the right thigh above the knee instead)
        c.hands['Right'] = [('hold', 0.0, 1.0, None, V3(-0.23, 0.50, -0.33), hq((0.1, -1, 0.15), (0.1, 0.3, -1)))]
        c.poles = lambda t: (V3(0.7, -0.7, 0.1), V3(-0.4, -0.6, -0.7))
        c.curl = const((1.0, 0.35))
        c.contacts = [x for x in contacts_seated(c) if x['part'].startswith('foot')] + [dict(part='hand_l', **{'from': 0}, to=0, node='steering_wheel', at=[round(x, 4) for x in c.hands['Left'][0][4]], kind='grip'),
                      ]
        c.events = {'handsOn': 0.0, 'seated': 0.0}
        return c
    raise KeyError(name)


def _bump(t, a, b):
    """0 outside [a, b], a smooth hump to 1 inside (sin^2)."""
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** 2


def drive_life(t):
    """The seated loop's life on top of the reference pose (8 s, every part periodic; zero at t = 0)."""
    P = 8.0
    w = 2 * math.pi / P

    def per(k, ph):  # a periodic wave that is 0 at t = 0
        return math.sin(w * k * t + ph) - math.sin(ph)
    breath = per(2, 0.0) * 0.5 + per(4, 1.0) * 0.15  # ~15 breaths a minute is 2 Hz/8s * ... (2 per 8 s cycle at k=2: 15/min)
    glance_l = _bump(t, 1.6, 2.9)   # the left mirror
    glance_r = _bump(t, 4.6, 5.7)   # the right mirror
    glance_c = _bump(t, 6.5, 7.3)   # the rear-view mirror
    shift = per(1, 0.4)
    return {
        'pelvis': Vector((0.006 * shift, 0.0, 0.004 * per(1, 2.0))),
        'turn': Vector((1.2 * per(1, 1.3), 0.6 * per(2, 0.3), 1.6 * shift)),
        'spine': Vector((0.9 * breath, -1.5 * per(1, 1.3) + 6.0 * glance_l - 7.0 * glance_r, -1.0 * shift)),
        'look': Vector((32.0 * glance_l - 48.0 * glance_r - 16.0 * glance_c + 2.0 * per(3, 0.5), -3.0 * glance_l + 2.0 * glance_r - 9.0 * glance_c + 1.0 * per(2, 1.1))),
        'collar': Vector((0.8 * breath, 0.6 * breath, -0.8 * breath, 0.6 * breath)),
    }


# ---------------------------------------------------------------- getting in and out (pass A2)
# Fitted to the car (numbers from the GLB with the vehicle fit, V): the open door hangs over the doorway at
# head height (x -1.26..-0.83; its rear edge at z -0.20 for y 1.0, -0.06 at 1.2, +0.09 at 1.4..1.5); the sill
# top slopes from y 0.23 at its outer edge (x -0.92) to 0.31 at x -0.80..-0.70, the opening z -0.65..+0.27;
# the roof's edge y 1.08 at x -0.60; the seat cushion 0.24..0.29 (x -0.58..-0.14, z -0.42..-0.06), the
# backrest rising from z -0.02; the rim's lowest point y 0.534 (z -0.37..-0.52).
HANDLE = V3(-0.957, 0.84, -0.20)  # the door's grab under the window (V, door shut)
DOOR_LOW = V3(-0.215, -0.578, 0.46)  # door_L frame: the door's bottom edge at its outer corner (open: its lowest corner, V -1.08, 0.80, -0.40)
DOOR_LOW_AXIS = V3(0.0, 0.0, 1.0)
POST = V3(-1.02, 0.66, 0.30)
HOLD_L = V3(-0.86, 0.29, 0.18)  # the sill's top behind the left hip, V (palm down, fingers outwards)
HOLD_LQ = ((0.77, -0.63, 0.06), (-0.84, -0.51, -0.18))  # palm down on the sloping outer sill, fingers over its outer edge
WING = V3(-0.640, 0.56, 0.11)  # the backrest's outer wing (the seat's side bolster), outside face, V
DOOR_PULL = V3(0.024, -0.488, 0.578)  # door_L frame: the door's inner bottom edge near its rear (open: V -0.92, 0.99, -0.40)
SEAT_AREA = ((-0.80, -0.10), (-0.46, 0.20), 0.56)  # where the hips rest on the seat (V): x, z ranges, highest pelvis
SEAT_PAD = (0.15, 0.25, 0.10)
POLE_UP = 0.1
DOOR_EDGE = V3(-0.212, -0.585, 0.84)  # door_L frame: the door's bottom edge, outer corner (open: its rear edge, V -1.14, 1.11, -0.18)
EXIT_EDGE_Q = ((0.58, 0.66, -0.49), (-0.66, -0.66, -0.36))  # (V, door open: the right hand round the door's rear edge from behind, fingers down its outer face)
EXIT_HANDLE_Q = ((0.78, 0.52, 0.34), (-0.09, 0.12, -0.99))  # (V, door open: the right hand on the grab from outside, reaching up, fingers forward along it)
Z_AXIS, X_AXIS = V3(0.0, 0.0, 1.0), V3(1.0, 0.0, 0.0)


def _door_pt(veh, p):
    return veh.to_local('door_L', p, {'door': 0.0})


def _door_q(veh, q):
    return (veh.world('door_L', {'door': 0.0}).to_quaternion().inverted() @ q).normalized()


def _door_dir(veh, d):
    return (veh.world('door_L', {'door': 0.0}).to_3x3().inverted() @ d).normalized()


def _door_q1(veh, q):
    """A hand's turn given in V with the door open, in the door's frame."""
    return (veh.world('door_L', {'door': 1.0}).to_quaternion().inverted() @ q).normalized()


def _seat_pt(veh, p):
    return veh.to_local('seat_driver', p)


def _seat_q(veh, q):
    return (veh.world('seat_driver').to_quaternion().inverted() @ q).normalized()


def _seat_dir(veh, d):
    return (veh.world('seat_driver').to_3x3().inverted() @ d).normalized()


def hang(side, forward=0.07, out=0.03, down=0.57):
    """A hand hanging by the thigh, under its shoulder ('@shoulder_l / _r' frame: x = the body's left, z = its
    forward), palm in, the elbow a little bent."""
    sx = 1 if side == 'Left' else -1
    p = V3(sx * out, -down, forward)
    return ('@shoulder_' + ('l' if side == 'Left' else 'r'), p, hq((-sx, 0, 0.1), (0, -1, 0.12)), p, V3(0, 1, 0), 50)


def _flat(x, z, yaw, y=0.0):
    """A flat foot's ground point at (x, z) (y: the floor's height)."""
    return (V3(x, y, z), yaw, 0.0)


def _bumpk(t, a, b, c, d):
    """0 before a, rising to 1 at b, 1 until c, falling to 0 at d (smooth)."""
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return ease((t - a) / (b - a))
    if t <= c:
        return 1.0
    return 1.0 - ease((t - c) / (d - c))


def enter(c):
    """car-enter (pass A2), 8.0 s, butt first:
    0.0  standing at entry_driver_point, facing forward, looking at the door
    0.5  half step in with the right foot, right hand to the door's grab (1.05)
    1.1  pulls and lifts the door to 45 % while stepping back out of its swing; lets go at 1.7, the strut takes
         the door up (open at 2.4)
    1.95 three steps and a turn to stand behind the door's rear edge with the back to the seat (3.3)
    3.4  right foot, then left foot, shuffle forward as the hips go down; the right hand takes the open door's
         lowest corner (4.3), the left hand the seat's outer bolster (4.55); hips back over the sill onto the
         seat's edge (4.65), the trunk leaning out so the head stays outside the roof and behind the door
    4.8  turning to the front on the seat: right leg over the sill and in to the accelerator (5.6), the knee in
         front of the rim's bottom; right hand to the rim at 3 o'clock (5.9); left leg after it (6.15); the
         trunk tilted out of the doorway so the head stays outside the roof's edge
    6.1  the head swings in under the roof (tilt from the left to the back); left hand up to the door's inner
         edge (6.35), pulls it down (6.35-7.0), lets go, the door drops shut (7.25)
    7.0  sits back; left hand to 9 o'clock (7.6); settled from 7.7 on car-drive frame 0."""
    veh = c.veh
    S = _seated_s()  # (pass A2 follow-up 2: this body's seated pose, as seated() takes it)
    seat = seat_root(veh)
    fl = (ground_for_ball(S['ball_l'][0], S['ball_l'][1], S['ball_l'][2]), S['ball_l'][1], S['ball_l'][2])
    fr = (ground_for_ball(S['ball_r'][0], S['ball_r'][1], S['ball_r'][2]), S['ball_r'][1], S['ball_r'][2])
    end = 8.0
    st = 0.915
    P = lambda *k: K(list(k))  # noqa: E731
    E = globals().get('ENTER_FIT', {})
    c.pelvis = P((0.0, (-1.55, st, -0.25)), (0.3, (-1.555, st - 0.015, -0.25)), (0.6, (-1.52, st - 0.025, -0.24)), (1.05, (-1.40, st - 0.04, -0.23), 'stop'), (1.45, (-1.42, st - 0.04, -0.23)),
                 (1.8, (-1.57, st - 0.015, -0.24)), (1.9, (-1.58, st - 0.025, -0.21)),
                 (2.4, (-1.50, st - 0.03, -0.03)), (2.9, (-1.40, st - 0.025, 0.03)), (3.35, (-1.36, st - 0.01, 0.04), 'stop'),
                 (3.8, (-1.26, 0.74, 0.01)), (4.2, (-1.02, 0.57, -0.05)), (4.55, (-0.82, 0.50, -0.09)), (4.85, (-0.68, 0.465, -0.11), 'stop'),
                 *E.get('pelvis', [(5.1, (-0.60, 0.46, -0.16)), (5.5, (-0.565, 0.374, -0.175)), (5.62, (-0.555, 0.37, -0.17)), (5.85, (-0.53, 0.44, -0.17)), (6.05, (-0.50, 0.425, -0.175)), (6.25, (-0.46, 0.41, -0.18)),
                                   (6.5, (-0.41, 0.38, -0.205)), (6.9, (-0.38, 0.37, -0.212)), (7.3, (-0.371, 0.372, -0.2145), 'stop')]),
                 (7.7, tuple(S['pelvis']), 'stop'))
    c.turn = P((0.0, (180.0, 0.0, 0.0)), (0.3, (180.0, 0.0, 0.0)), (0.6, (182.0, 2.0, 1.0)), (1.05, (186.0, 8.0, 6.0), 'stop'), (1.6, (182.0, 2.0, 1.0)),
               (1.9, (186.0, 0.0, 0.0)), (2.4, (228.0, 2.0, 0.0)), (2.9, (264.0, 3.0, 0.0)), (3.35, (282.0, 6.0, 0.0), 'stop'),
               (3.8, (284.0, 24.0, 0.0)), (4.2, (286.0, 30.0, -2.0)), (4.55, (288.0, 28.0, -2.0)), (4.85, (288.0, 24.0, -2.0), 'stop'),
               *E.get('turn', [(5.1, (270.0, 16.0, -8.0)), (5.45, (246.0, 9.0, -17.0)), (5.8, (226.0, 4.0, 7.0)), (6.05, (210.0, 0.0, 2.0)), (6.25, (192.0, -5.0, -20.0)),
                               (6.5, (186.0, -28.0, -17.0)), (6.8, (183.0, -38.0, -10.0)), (7.05, (181.0, -41.0, -3.0)), (7.3, (180.0, -42.0, 0.0), 'stop')]),
               (7.7, tuple(S['turn']), 'stop'))
    c.spine = P((0.0, (2.0, 0.0, 0.0)), (0.4, (2.0, 0.0, 0.0)), (1.05, (8.0, 6.0, 12.0), 'stop'), (1.6, (2.0, 2.0, 2.0)),
                (1.9, (2.0, 0.0, 0.0)), (3.35, (6.0, 0.0, 0.0), 'stop'), (3.8, (12.0, 0.0, -2.0)), (4.2, (18.0, 0.0, -6.0)),
                (4.85, (16.0, 0.0, -12.0)),
                *E.get('spine', [(5.2, (14.0, 0.0, -20.0)), (5.6, (10.0, 0.0, -32.0)), (5.9, (8.0, 0.0, -38.0)), (6.05, (7.0, 0.0, -40.0)), (6.25, (5.0, 0.0, -28.0)),
                                 (6.5, (5.0, 0.0, -20.0)), (6.8, (4.0, 0.0, -11.0)), (7.05, (4.0, 0.0, -3.0)), (7.3, (4.0, 0.0, 0.0), 'stop')]),
                (7.7, tuple(S['spine']), 'stop'))
    c.look = P((0.0, (0.0, 8.0)), (0.5, (30.0, 20.0)), (1.05, (40.0, 15.0)), (1.6, (25.0, -10.0)), (2.1, (10.0, 10.0)),
               (2.9, (-30.0, 10.0)), (3.35, (-25.0, 5.0)), (3.9, (20.0, 30.0)), (4.65, (0.0, 15.0)), (5.1, (-30.0, 25.0)),
               (5.6, (-10.0, 30.0)), (6.1, (20.0, 20.0)), (6.5, (45.0, -5.0)), (7.0, (35.0, 5.0)), (7.5, (5.0, 15.0)),
               (7.9, tuple(S['look']), 'stop'))
    c.collar = P((0.0, (0.0, 0.0, 0.0, 0.0)), (1.05, (0.0, 0.0, 8.0, 8.0)), (1.8, (0.0, 0.0, 0.0, 0.0)), (3.35, (0.0, 0.0, 0.0, 0.0)),
                 (4.35, (-6.0, -4.0, 6.0, 12.0)), (4.65, (-6.0, -4.0, 4.0, 6.0)), (5.6, (-10.0, 0.0, 10.0, 0.0)),
                 (6.5, (-20.0, 14.0, 12.0, 0.0)), (7.1, tuple(S['collar'])), (7.6, tuple(S['collar']), 'stop'))
    def poles(t):
        if t >= 6.9:  # (the left elbow kept down by the closing door, then the seated pose's)
            w2 = _bumpk(t, 6.9, 7.1, 7.4, 7.7)
            return (Vector(S['poles'][0]).lerp(V3(0.5, -0.95, -0.1), w2), S['poles'][1])
        w = _bumpk(t, 0.45, 0.9, 1.4, 1.9)  # (the right elbow out to the side for the door's grab)
        return (V3(0.7, -0.8, -0.2), V3(-0.7, -0.8, -0.2).lerp(V3(-0.9, POLE_UP, -0.3), w))
    c.poles = poles
    c.ctl = {'door': K([(0.0, 0.0), (1.1, 0.0, 'stop'), (1.3, 0.12), (2.15, 1.0, 'stop'), (6.35, 1.0, 'stop'), (6.68, 0.56), (7.05, 0.22), (7.35, 0.0, 'stop')]),
             'wheel': 0.0}
    c.curl = K([(0.0, (0.25, 0.25)), (0.7, (0.25, 0.4)), (1.05, (0.25, 0.85)), (1.7, (0.25, 0.85)), (1.95, (0.25, 0.25)),
                (3.9, (0.25, 0.3)), (4.05, (0.25, 0.8)), (4.3, (0.25, 0.8)), (4.55, (0.2, 0.35)), (4.8, (0.2, 0.3)), (4.92, (0.6, 0.3)), (5.04, (0.6, 0.3)),
                (5.12, (0.2, 0.3)), (5.3, (0.25, 0.3)), (6.05, (0.25, 0.3)), (6.35, (0.1, 0.4)), (6.65, (0.1, 0.6)), (6.85, (0.2, 1.0)), (7.0, (0.4, 1.0)), (7.45, (0.5, 1.0)),
                (7.7, (1.0, 1.0), 'stop')])
    c.finger_pose = wheel_grip(c.author.fingers)
    grip_l, grip_r = rim_grip(270, 'Left'), rim_grip(90, 'Right')
    hl = _door_pt(veh, HANDLE)
    corner_q = _door_q1(veh, hq((0.33, 0.94, -0.09), (0.97, 0.0, -0.26)))  # palm up under the door's lowest corner, fingers inwards
    post_q = hq((0.82, -0.56, 0.08), (-0.14, 0.88, -0.46))  # palm on the pillar's outer corner, fingers up
    hold_lq = hq(*HOLD_LQ)
    pull_q = _door_q1(veh, hq((-0.99, -0.02, -0.11), (0.05, 0.8, -0.6)))  # palm on the door's inner face at its lower edge, fingers up
    c.hands = {
        'Right': [('hold', 0.0, 0.55, *hang('Right')), ('move', 0.55, 1.05, [V3(-1.18, 0.84, -0.22)], 0.0),
                  ('hold', 1.05, 1.3, 'door_L', hl, _door_q(veh, hq((0.8, 0.6, 0.0), (0.6, -0.8, 0.11))), hl + veh.world('door_L', {'door': 0.0}).to_3x3().inverted() @ V3(0.0, -0.02, 0.0), _door_dir(veh, Z_AXIS), 20),
                  ('move', 1.3, 1.85, [], 0.0), ('hold', 1.85, 3.65, *hang('Right')),
                  ('move', 3.65, 4.05, [V3(-1.32, 0.90, -0.30)], 0.01),
                  ('hold', 4.05, 4.3, 'door_L', DOOR_LOW, corner_q, DOOR_LOW + V3(0.015, 0.018, 0.0), DOOR_LOW_AXIS, 60),
                  ('move', 4.3, 4.85, [V3(-1.12, 0.66, -0.30)], 0.01), ('hold', 4.85, 6.2, *hang('Right', -0.02, 0.12, 0.47)),
                  ('move', 6.2, 6.8, [V3(-0.22, 0.74, -0.27)], 0.01),
                  ('hold', 6.8, end + 1, 'steering_wheel', *grip_r)],
        'Left': [('hold', 0.0, 4.5, *hang('Left')), ('move', 4.5, 4.82, [V3(-0.88, 0.42, 0.18)], 0.0, 'plain'),
                 ('hold', 4.82, 5.1, 'body_shell', HOLD_L, hold_lq, HOLD_L + V3(0.0, -0.02, 0.0), V3(0.0, 0.0, 1.0), 20),
                 ('move', 5.1, 5.4, [V3(-0.86, 0.47, 0.18)], 0.0), ('hold', 5.4, 5.8, '@body', V3(0.13, 0.0, 0.22), hq((0.0, -1.0, 0.0), (0.1, 0.0, 1.0))),
                 ('move', 5.8, 6.35, [V3(-0.60, 0.80, -0.30), V3(-0.70, 0.94, -0.37)], 0.0),
                 ('hold', 6.35, 6.68, 'door_L', DOOR_PULL, pull_q, DOOR_PULL + V3(-0.012, 0.014, 0.0), V3(0, 0, 1), 90),
                 ('move', 6.68, 7.45, [V3(-0.60, 0.62, -0.40)], 0.0), ('hold', 7.45, 7.5, 'steering_wheel', *grip_l), ('move', 7.5, 7.6, [], 0.0), ('hold', 7.6, end + 1, 'steering_wheel', *grip_l)],
    }
    c.auto_contacts = {('Right', 2): 'handle', ('Right', 6): 'grip', ('Right', 10): 'grip', ('Left', 2): 'grip', ('Left', 6): 'grip', ('Left', 10): 'grip'}
    c.feet = {
        'Left': [('plant', 0.0, 1.95, None, *_flat(-1.65, -0.27, 180.0)), ('step', 1.95, 2.4, 0.07, []),
                 ('plant', 2.4, 2.95, None, *_flat(-1.42, 0.10, 240.0)), ('step', 2.95, 3.3, 0.06, []),
                 ('plant', 3.3, 4.62, None, *_flat(-1.30, 0.14, 280.0)), ('step', 4.62, 5.1, 0.08, []),
                 ('plant', 5.1, 5.6, 'body_shell', ground_for_ball(V3(-0.97, 0.22, 0.03), 268.0, -20.0), 268.0, -20.0),  # (the foot up on the sill's outer edge)
                 ('step', 5.6, 6.4, 0.0, E.get('viaL', [V3(-1.02, 0.45, -0.12), V3(-0.80, 0.44, -0.36), V3(-0.60, 0.36, -0.58)])),
                 ('plant', 6.4, 6.85, 'interior', *_flat(-0.46, -0.74, 192.0, 0.165)), ('step', 6.85, 7.3, 0.03, [V3(-0.42, 0.26, -0.86), V3(-0.41, 0.27, -0.98)], lambda x: 12.0 * ease(x / 0.5)),
                 ('plant', 7.3, end + 1, 'interior', *fl)],
        'Right': [('plant', 0.0, 0.3, None, *_flat(-1.45, -0.24, 180.0)), ('step', 0.3, 0.6, 0.05, []),
                  ('plant', 0.6, 1.5, None, *_flat(-1.32, -0.22, 174.0)), ('step', 1.5, 1.82, 0.05, []),
                  ('plant', 1.82, 2.45, None, *_flat(-1.50, -0.22, 186.0)), ('step', 2.45, 2.9, 0.07, []),
                  ('plant', 2.9, 5.0, None, *_flat(-1.22, -0.07, 276.0)),
                  ('step', 5.0, 5.85, 0.0, E.get('viaR', [V3(-1.24, 0.40, -0.10), V3(-1.02, 0.46, -0.24), V3(-0.78, 0.36, -0.36), V3(-0.50, 0.24, -0.52), V3(-0.34, 0.24, -0.78)])),
                  ('plant', 5.85, end + 1, 'interior', *fr)],
    }
    # the knees: the right one forward and to the right as it comes in (in front of the rim's bottom), the left one
    # forward and out; back to the rig's own (on the foot) as the feet settle
    ke0, ke1 = EX.get('ke0', 6.25), EX.get('ke1', 0.2)  # (pass A3: when the right knee goes over to the reference's pole)
    U = _ue5()  # (the EarthOnline body's own values; empty for Tripo)
    def knees(t):
        a = ease((t - 5.9) / 0.5)  # (up while the foot is outside, then out to the side once it is in)
        b = ease((t - U.get('kb0', 5.2)) / U.get('kb1', 0.4))
        kl = V3(-0.2, 1.0, -0.3).lerp(V3(-0.7, 0.6, -0.3), a)
        kr = V3(0.1, 1.0, -0.4).lerp(Vector(U.get('kr1', (0.6, 0.3, -0.6))), b).lerp(V3(0.45, 0.25, -0.85), ease((t - 5.8) / 0.3))
        wl, wr = _bumpk(t, 4.7, 5.0, 6.6, 7.5), _bumpk(t, 4.9, 5.2, 5.9, 6.6)
        if S.get('knees_w'):  # (pass A3: after the old poles have faded to rest (6.6 / 7.5 s), into the reference's own)
            e = ease((t - ke0) / ke1)
            if e > 0.0:
                kr, wr = Vector(S['knees'][1]), e * S['knees_w'][1]
        return (kl, kr, (wl, wr))
    c.knees = knees
    c.auto_contacts.update({('footLeft', 6): 'step', ('footLeft', 8): 'rest', ('footLeft', 10): 'rest', ('footRight', 8): 'press'})
    c.root0, c.root1 = ENTRY_ROOT, seat
    c.balance, c.seat_area, c.seat_pad, c.fixed_roll, c.seated_from = True, SEAT_AREA, SEAT_PAD, True, 6.6
    c.contact_lead = {'Left': 0.03}  # (the left foot's last 2 cm into its resting place, against the footwell's side, are on its contact)
    c.events = {'doorOpenStart': 1.1, 'doorOpenEnd': 2.2, 'seated': 4.7, 'doorCloseStart': 6.35, 'doorCloseEnd': 7.35, 'handsOn': 7.6}


DOOR_IN = V3(-0.715, 0.62, -0.30)  # V, door shut: the palm on the door's inner panel at shoulder height, pushing it open


def _reverse_plan(plan, e0, e1, emap):
    """The steps of `plan` (enter-clip times) inside [e0, e1], in reverse time order with times mapped by emap
    (e1 -> earliest), each step's via points reversed."""
    out = []
    for st in plan:
        a, b = max(st[1], e0), min(st[2], e1)
        if a >= b:
            continue
        st2 = list(st)
        st2[1], st2[2] = emap(b), emap(a)
        if st[0] == 'step':
            st2[4] = list(reversed(st[4]))
            if len(st) > 5 and callable(st[5]):  # (a pitch curve over the step runs backwards too)
                st2[5] = (lambda f: (lambda x: f(1.0 - x)))(st[5])
        out.append(tuple(st2))
    return list(reversed(out))


def exit_(c):
    """car-exit (pass A2), 7.8 s, from car-drive frame 0:
    0.3  left hand off the rim onto the door's inner panel and pushes the door up to 35 % (0.6-1.0); the strut opens
         it (1.6)
    1.0  the head ducks out under the roof's edge (the trunk tilting from the backrest to the doorway), the left leg
         out over the sill (1.6-2.4) and onto the sill's edge, the right leg out from under the rim (1.9-2.7), the
         hips sliding out to the seat's edge facing out (4.1); the left hand rests on the thigh, the right leaves
         the rim (1.9) and hangs
         (this middle part, 1.0-4.1, follows car-enter's checked path through the doorway backwards: the same
         poses, the order of the legs reversed, the door already open)
    3.9  left hand on the sill, right hand under the open door's lowest corner: leans forward and stands up out of
         the doorway, head first, behind the door's lower edge (4.1-5.2)
    5.3  two steps round to face the car's front beside the door; right hand up to the door's grab (5.9), pulls it
         down to 30 % (6.4), lets go, it drops shut (6.75)
    6.6  two steps back to the entry point; standing, hands at the sides, from 7.45."""
    veh = c.veh
    S = _seated_s()  # (pass A2 follow-up 2: this body's seated pose, as seated() takes it)
    seat = seat_root(veh)
    fl = (ground_for_ball(S['ball_l'][0], S['ball_l'][1], S['ball_l'][2]), S['ball_l'][1], S['ball_l'][2])
    fr = (ground_for_ball(S['ball_r'][0], S['ball_r'][1], S['ball_r'][2]), S['ball_r'][1], S['ball_r'][2])
    ce = Clip('car-enter', veh, c.author, 8.0, loop=False)
    keep = dict(EX)
    EX.update(EX.get('exit_k', {}))  # (pass A3: the knee's switch onto the reference timed for the way out)
    enter(ce)
    EX.clear(); EX.update(keep)
    ce.plan_balance()
    W0, E0, E1 = 1.0, 7.7, 4.6
    W1 = W0 + (E0 - E1)
    emap = lambda e: W0 + (E0 - e)  # noqa: E731  (enter time -> exit time)

    def ee(t):  # exit time -> enter time inside the window
        return E0 - (min(max(t, W0), W1) - W0)

    def bal(e):
        b = ce._bal
        x = max(0.0, min(len(b) - 1.0, e * 30))
        k = int(x)
        return b[k].lerp(b[min(k + 1, len(b) - 1)], x - k)
    st = 0.915
    end = 7.8
    P = lambda *k: K(list(k))  # noqa: E731
    p_after = P((W1, tuple(ce.pelvis(E1) + bal(E1))), (4.45, (-0.82, 0.52, -0.08)), (4.85, (-1.04, 0.66, -0.02)), (5.2, (-1.47, 0.885, 0.06)),
                (5.38, (-1.56, st - 0.02, 0.06)), (5.62, (-1.58, st - 0.02, -0.12)), (5.85, (-1.60, st - 0.02, -0.34), 'stop'), (6.1, (-1.62, st - 0.03, -0.36)), (6.3, (-1.61, st - 0.05, -0.35), 'stop'),
                (6.8, (-1.58, st - 0.02, -0.32)), (7.3, (-1.55, st, -0.25), 'stop'))
    t_after = P((W1, tuple(ce.turn(E1))), (4.45, (288.0, 30.0, 0.0)), (4.85, (286.0, 26.0, 0.0)), (5.2, (282.0, 8.0, 0.0), 'stop'),
                (5.38, (250.0, 2.0, 0.0)), (5.62, (200.0, 2.0, 0.0)), (5.85, (152.0, 2.0, 0.0), 'stop'), (6.1, (150.0, 4.0, -2.0)), (6.3, (150.0, 8.0, -2.0), 'stop'), (6.8, (168.0, 2.0, 0.0)),
                (7.3, (180.0, 0.0, 0.0), 'stop'))
    s_after = P((W1, tuple(ce.spine(E1))), (4.45, (20.0, 0.0, -4.0)), (4.85, (16.0, 0.0, -2.0)), (5.2, (4.0, 0.0, 0.0), 'stop'),
                (6.0, (4.0, 6.0, 6.0)), (6.3, (8.0, 4.0, 6.0)), (6.8, (2.0, 0.0, 0.0)), (7.3, (2.0, 0.0, 0.0), 'stop'))
    l_after = P((W1, tuple(ce.look(E1))), (4.6, (-10.0, 30.0)), (5.1, (10.0, 10.0)), (5.5, (-20.0, 0.0)), (5.95, (30.0, -25.0)),
                (6.45, (30.0, -5.0)), (7.05, (0.0, 6.0)), (7.6, (0.0, 8.0), 'stop'))
    c_after = P((W1, tuple(ce.collar(E1))), (4.6, (-6.0, -4.0, 6.0, 12.0)), (5.2, (0.0, 0.0, 0.0, 0.0)), (5.9, (0.0, 0.0, 8.0, 10.0)),
                (6.45, (0.0, 0.0, 4.0, 4.0)), (7.05, (0.0, 0.0, 0.0, 0.0), 'stop'))

    def chan(fn_enter, after, offset=None):
        def f(t):
            if t <= W1:
                v = fn_enter(ee(t))
                return v + offset(ee(t)) if offset else v
            return after(t)
        return f
    c.pelvis = chan(ce.pelvis, p_after, bal)
    c.turn = chan(ce.turn, t_after)
    c.spine = chan(ce.spine, s_after)
    look_mid = chan(ce.look, l_after)
    c.look = lambda t: Vector(S['look']).lerp(look_mid(t), ease((t - 0.2) / 0.8))  # (from the seated pose's own head)
    c.collar = chan(ce.collar, c_after)

    def poles(t):
        if t <= W1:
            pl, pr = ce.poles(ee(t))
        else:
            pl, pr = V3(0.7, -0.8, -0.2), V3(-0.7, -0.8, -0.2)
        if t < W0:  # (the left elbow down for the push on the door)
            pl = Vector(pl).lerp(V3(0.3, -1.0, 0.2), _bumpk(t, 0.25, 0.55, 0.95, 1.25))
        pl = Vector(pl).lerp(V3(0.5, -0.8, 0.4), _bumpk(t, 1.0, 1.4, 1.9, 2.4))  # (and forward, off the seat's wing, to the thigh)
        return (Vector(pl), Vector(pr).lerp(V3(-0.9, 0.1, -0.3), _bumpk(t, 5.4, 5.85, 6.5, 7.0)))
    c.poles = poles
    c.ctl = {'door': K([(0.0, 0.0), (0.65, 0.0, 'stop'), (1.0, 0.35), (1.6, 1.0, 'stop'), (6.0, 1.0, 'stop'), (6.13, 0.76), (6.65, 0.0, 'stop')]),
             'wheel': 0.0}
    c.curl = K([(0.0, (1.0, 1.0)), (0.2, (1.0, 1.0)), (0.45, (0.2, 1.0)), (1.0, (0.2, 1.0)), (1.25, (0.3, 1.0)), (1.7, (0.3, 1.0)), (1.88, (0.3, 0.35)),
                (3.25, (0.2, 0.3)), (3.38, (0.6, 0.3)), (3.55, (0.6, 0.3)), (3.64, (0.15, 0.3)), (4.05, (0.25, 0.8)), (4.6, (0.25, 0.8)), (4.85, (0.25, 0.3)),
                (5.85, (0.25, 0.4)), (6.0, (0.25, 0.85)), (6.3, (0.25, 0.85)), (6.45, (0.25, 0.3)), (7.45, (0.25, 0.25), 'stop')])
    c.finger_pose = wheel_grip(c.author.fingers)
    grip_l, grip_r = rim_grip(270, 'Left'), rim_grip(90, 'Right')
    din = _door_pt(veh, DOOR_IN)
    in_q = _door_q(veh, hq((-1.0, 0.0, 0.0), (0.0, 0.6, -0.8)))
    hl = _door_pt(veh, HANDLE)
    corner_q = _door_q1(veh, hq((0.33, 0.94, -0.09), (0.97, 0.0, -0.26)))
    hold_lq = hq(*HOLD_LQ)
    # (the left hand resting on the thigh already turned as it will be on the sill: no turn on the way there)
    rest_lq = (Quaternion((0, 1, 0), -math.radians(ce.turn(ee(2.95))[0])) @ hold_lq).normalized()
    hand_out_q = _door_q1(veh, hq(*EXIT_HANDLE_Q))
    edge_q = _door_q1(veh, hq(*EXIT_EDGE_Q))
    c.hands = {
        'Left': [('hold', 0.0, 0.2, 'steering_wheel', *grip_l), ('move', 0.2, 0.65, [V3(-0.55, 0.66, -0.31)], 0.0),
                 ('hold', 0.65, 1.0, 'door_L', din, in_q, din + V3(0.02, 0.0, 0.0), V3(0, 0, 1), 30),
                 ('move', 1.0, 1.5, [V3(-0.56, 0.55, -0.26)], 0.0), ('hold', 1.5, 2.95, '@body', V3(0.13, 0.10, 0.13), rest_lq),
                 ('move', 2.95, 3.32, [], 0.0),
                 ('hold', 3.32, 3.62, 'body_shell', HOLD_L, hold_lq, HOLD_L + V3(0.0, -0.02, 0.0), V3(0.0, 0.0, 1.0), 20),
                 ('move', 3.62, 4.3, [V3(-0.88, 0.40, 0.19), V3(-0.95, 0.56, 0.16)], 0.0), ('hold', 4.3, end + 1, *hang('Left'))],
        'Right': [('hold', 0.0, 1.9, 'steering_wheel', *grip_r), ('move', 1.9, 2.5, [V3(-0.22, 0.74, -0.27)], 0.01),
                  ('hold', 2.5, 3.85, *hang('Right', -0.02, 0.12, 0.47)), ('move', 3.85, 4.15, [V3(-1.10, 0.70, -0.30)], 0.0),
                  ('hold', 4.15, 4.6, 'door_L', DOOR_LOW, corner_q, DOOR_LOW + V3(0.015, 0.018, 0.0), DOOR_LOW_AXIS, 40),
                  ('move', 4.6, 5.0, [], 0.0), ('hold', 5.0, 5.3, *hang('Right')), ('move', 5.3, 6.0, [V3(-1.48, 1.10, -0.42), V3(-1.42, 1.34, -0.52)], 0.0),
                  ('hold', 6.0, 6.13, 'door_L', hl, hand_out_q, hl + veh.world('door_L', {'door': 0.0}).to_3x3().inverted() @ V3(0.0, -0.02, 0.0), _door_dir(veh, Z_AXIS), 30),
                  ('move', 6.13, 7.0, [V3(-1.36, 1.24, -0.54), V3(-1.44, 0.95, -0.40)], 0.0), ('hold', 7.0, end + 1, *hang('Right'))],
    }
    c.auto_contacts = {('Left', 0): 'grip', ('Left', 2): 'push', ('Left', 6): 'push', ('Right', 0): 'grip', ('Right', 4): 'grip', ('Right', 8): 'handle'}
    fe = {}
    for side in ('Left', 'Right'):
        mid = _reverse_plan(ce.feet[side], E1, E0, emap)
        mid[0] = (mid[0][0], 0.0) + mid[0][2:]  # (from the start: the seated plant)
        fe[side] = mid
    # after the window: from the feet outside, round to the car's front, back to the entry point
    lp, rp = fe['Left'][-1], fe['Right'][-1]
    fe['Left'][-1] = lp[:2] + (5.08,) + lp[3:]
    fe['Right'][-1] = rp[:2] + (4.8,) + rp[3:]
    fe['Right'] += [('step', 4.8, 5.05, 0.06, []), ('plant', 5.05, 5.62, None, *_flat(-1.44, -0.02, 270.0))]
    fe['Left'] += [('step', 5.08, 5.35, 0.06, []), ('plant', 5.35, 5.38, None, *_flat(-1.52, 0.18, 262.0)), ('step', 5.38, 5.6, 0.06, []), ('plant', 5.6, 6.5, None, *_flat(-1.68, -0.16, 160.0)), ('step', 6.5, 6.9, 0.05, []),
                   ('plant', 6.9, end + 1, None, *_flat(-1.65, -0.27, 180.0))]
    fe['Right'] += [('step', 5.62, 5.92, 0.06, []), ('plant', 5.92, 6.92, None, *_flat(-1.52, -0.44, 150.0)), ('step', 6.92, 7.28, 0.05, []),
                    ('plant', 7.28, end + 1, None, *_flat(-1.45, -0.24, 180.0))]
    c.feet = fe
    c.knees = lambda t: (lambda k: (k[0], k[1], k[2] if t <= W1 else (0.0, 0.0)))(ce.knees(ee(t)))
    c.root0, c.root1 = seat, ENTRY_ROOT
    c.balance, c.seat_area, c.seat_pad, c.fixed_roll = True, SEAT_AREA, SEAT_PAD, True
    c.seated_before = W1
    c.contact_trail = {'Left': 0.03, 'Right': 0.02}
    c.events = {'handsOff': 0.2, 'doorOpenStart': 0.65, 'doorOpenEnd': 1.6, 'unseated': 4.3, 'doorCloseStart': 6.0, 'doorCloseEnd': 6.65}


EX = {'exit_k': {'ke0': 6.26, 'ke1': 0.12},
      # (pass A3 follow-up: car-exit's middle as its own move, exit_middle(): the left hand on the roof's edge over the
      # doorway, the right hand hanging by the thigh the whole way (no hold under the door's corner), the right foot
      # out wide under the wheel)
      'on': True, 'seat_push': False, 'r2': 3.4, 'roof_at': Vector((-0.62, 1.05, -0.10)), 'no_corner': 'merge',
      'hang_r': (0.15, 0.03, 0.52), 'lvia0': [Vector((-0.57, 0.63, -0.31))], 'rvia2': [Vector((-1.00, 0.85, 0.08))],
      'kb': (1.2, 1.8, 3.6, 4.2),
      'hang_r2': (3.9, 4.25, (0.07, 0.14, 0.57)),
      'viaR': [Vector(v) for v in ((-0.48, 0.245, -0.74), (-0.70, 0.29, -0.625), (-0.92, 0.42, -0.43), (-1.08, 0.48, -0.24), (-1.20, 0.30, -0.12))],
      'p': [(1.6, (-0.40, 0.37, -0.21)), (2.3, (-0.50, 0.42, -0.19)), (3.0, (-0.58, 0.51, -0.13)), (3.4, (-0.66, 0.51, -0.12)), (3.8, (-0.80, 0.50, -0.13))],
      's': [(1.5, (4.0, 10.0, -12.0)), (2.0, (5.0, 16.0, -22.0)), (2.6, (6.0, 20.0, -26.0)), (3.2, (16.0, 12.0, -20.0)), (3.6, (17.0, 4.0, -16.0))]}
try:  # (fitting: values tried from a script)
    import bpy as _bpy2
    EX.update(_bpy2.app.driver_namespace.get('car_EX', {}))
except ImportError:
    pass


def exit_middle(c):
    """(pass A3) car-exit's middle (1.0-4.1 s) as its own move, over exit_()'s start (door open) and end (standing up
    beside the door): the head and left shoulder lead out through the doorway (the trunk turning out and leaning left
    from 1.0); the left foot comes up off the floor (1.4-1.85) and goes over the sill straight down to the ground outside
    (2.3-3.0); the left hand on the sill behind the hip (2.8-3.75): the weight on that foot and that hand while the right
    leg comes out from under the rim over the sill to the ground (3.25-4.0); the hips then rise off the seat's edge."""
    old_p, old_t, old_s = c.pelvis, c.turn, c.spine
    T0, T1 = 1.0, 4.1
    P = lambda ks: K([(t, tuple(v)) + tuple(rest) for t, v, *rest in ks])  # noqa: E731

    def tail(f):  # (the old curve's last part, so the new one joins it in value and slope)
        return [(T1, tuple(f(T1))), (T1 + 0.2, tuple(f(T1 + 0.2)))]
    mid_p = P([(T0, tuple(old_p(T0)), 'stop')] + [(t, v) for t, v in EX.get('p', [
        (1.6, (-0.40, 0.37, -0.21)), (2.3, (-0.50, 0.40, -0.18)), (3.0, (-0.58, 0.47, -0.13)), (3.4, (-0.66, 0.49, -0.12)),
        (3.8, (-0.80, 0.49, -0.13))])] + tail(old_p))
    mid_t = P([(T0, tuple(old_t(T0)), 'stop')] + [(t, v) for t, v in EX.get('t', [
        (1.5, (184.0, -41.0, -4.0)), (2.0, (190.0, -40.0, -8.0)), (2.5, (196.0, -36.0, -8.0)), (3.0, (200.0, -18.0, -6.0)),
        (3.5, (245.0, 6.0, -6.0))])] + tail(old_t))
    mid_s = P([(T0, tuple(old_s(T0)), 'stop')] + [(t, v) for t, v in EX.get('s', [
        (1.5, (4.0, 10.0, -12.0)), (2.0, (5.0, 16.0, -22.0)), (2.6, (8.0, 20.0, -26.0)), (3.2, (16.0, 12.0, -20.0)),
        (3.6, (17.0, 4.0, -16.0))])] + tail(old_s))
    c.pelvis = lambda t: mid_p(t) if T0 < t < T1 else old_p(t)
    c.turn = lambda t: mid_t(t) if T0 < t < T1 else old_t(t)
    c.spine = lambda t: mid_s(t) if T0 < t < T1 else old_s(t)
    fl, fr = c.feet['Left'], c.feet['Right']
    # left: up off the floor (kept), then over the sill straight down to the ground outside, where it stays
    l_out = [st for st in fl if st[0] == 'plant' and st[3] is None and st[1] >= 3.5][0]  # (the old ground plant from 4.08)
    new_l = fl[:3] + [('step', 2.3, 3.0, 0.0, EX.get('viaL', [V3(-0.60, 0.36, -0.58), V3(-0.80, 0.44, -0.36), V3(-1.02, 0.47, -0.10), V3(-1.14, 0.26, 0.06)])),
                      ('plant', 3.0, l_out[2], None, *_flat(-1.16, 0.08, 255.0))] + [st for st in fl if st[1] >= l_out[2] - 1e-6]
    r_out = [st for st in fr if st[0] == 'plant' and st[3] is None][0]  # (the old ground plant)
    new_r = [(fr[0][0], fr[0][1], 1.5) + fr[0][3:], ('step', 1.5, 1.9, 0.04, []),
             ('plant', 1.9, 3.25, 'interior', *_flat(*EX.get('rfloor', (-0.42, -0.80)), 186.0, 0.165)), ('step', 3.25, 4.0, 0.0, EX.get('viaR', [V3(-0.40, 0.26, -0.68), V3(-0.54, 0.28, -0.50), V3(-0.78, 0.36, -0.36),
                                                                                              V3(-1.02, 0.46, -0.24), V3(-1.20, 0.30, -0.12)])),
             ('plant', 4.0) + r_out[2:]] + [st for st in fr if st[1] >= r_out[2] - 1e-6]
    c.feet = {'Left': new_l, 'Right': new_r}
    hl = c.hands['Left']
    if EX.get('lvia0'):  # (the left hand's way off the wheel)
        hl[1] = hl[1][:3] + (EX['lvia0'],) + hl[1][4:]
    sill = [st for st in hl if st[0] == 'hold' and st[3] == 'body_shell'][0]
    k = hl.index(sill)
    hl[k - 2] = hl[k - 2][:2] + (2.4,) + hl[k - 2][3:]
    hl[k - 1] = ('move', 2.4, 2.88, [V3(-0.74, 0.46, 0.06)], 0.0)
    sp = EX.get('sill', V3(-0.86, 0.29, 0.08))
    hl[k] = ('hold', 2.88, 3.5, sill[3], sp, sill[5], sp + V3(0.0, -0.02, 0.0)) + sill[7:]
    hl[k + 1] = ('move', 3.5, hl[k + 1][2], [V3(-0.92, 0.46, 0.16)]) + hl[k + 1][4:]
    if EX.get('roof', True):
        # (the left hand up on the roof's edge over the doorway instead of the sill: the head and shoulder lead out
        # under it, the weight hangs on it while the right leg comes out)
        rp = EX.get('roof_at', V3(-0.60, 1.075, -0.10))
        hl[k - 2] = hl[k - 2][:2] + (EX.get('r0', 1.8),) + hl[k - 2][3:]
        hl[k - 1] = ('move', EX.get('r0', 1.8), EX.get('r1', 2.2), EX.get('rvia', [V3(-0.52, 0.85, -0.18)]), 0.0)
        hl[k] = ('hold', EX.get('r1', 2.2), EX.get('r2', 3.75), 'body_shell', rp, hq(*EX.get('roof_q', ((-0.3, 1.0, 0.0), (-1.0, 0.0, 0.1)))),
                 rp, V3(0.0, 0.0, 1.0), 60)
        hl[k + 1] = ('move', EX.get('r2', 3.75), hl[k + 1][2], EX.get('rvia2', [V3(-0.80, 0.80, 0.0)])) + hl[k + 1][4:]
    old_k = c.knees

    def knees(t):  # (the right knee up and inwards, off the centre tunnel, while the hips go left over a foot still on the pedal)
        kl, kr, w = old_k(t)
        x = _bumpk(t, *EX.get('kb', (1.2, 1.8, 3.4, 4.0)))
        if not x:
            return kl, kr, w
        wl, wr = w if isinstance(w, tuple) else (w, w)
        return kl, Vector(kr).lerp(EX.get('kr', V3(-0.7, 0.7, -0.2)), x), (wl, max(wr, x))
    c.knees = knees
    hr = c.hands['Right']
    hr[0] = hr[0][:2] + (1.45,) + hr[0][3:]
    hr[1] = ('move', 1.45) + hr[1][2:]
    if EX.get('corner_end'):
        # (the right hand under the door's lowest corner for a shorter push, turned for the wrist at that moment)
        kc = [i for i, st in enumerate(hr) if st[0] == 'hold' and st[3] == 'door_L'][0]
        q = _door_q1(c.veh, hq(*EX.get('corner_q', ((0.33, 0.94, -0.09), (0.94, -0.33, -0.01)))))
        hr[kc] = (hr[kc][0], hr[kc][1], EX['corner_end'], hr[kc][3], hr[kc][4], q) + hr[kc][6:]
        hr[kc + 1] = (hr[kc + 1][0], EX['corner_end']) + hr[kc + 1][2:]
    if EX.get('no_corner', False):
        # (no hand under the door's corner: the body leaves the doorway under the roof's edge, the right hand at the side)
        kc = [i for i, st in enumerate(hr) if st[0] == 'hold' and st[3] == 'door_L'][0]
        hr[kc] = ('hold', hr[kc][1], hr[kc][2], *hang('Right'))
        c.auto_contacts = {kk: v for kk, v in c.auto_contacts.items() if kk != ('Right', kc)}
        if EX['no_corner'] == 'merge':  # (one hanging hold from the wheel's release until the hand goes for the handle)
            hd = [i for i, st in enumerate(hr) if st[0] == 'hold' and st[3] == 'door_L'][-1]  # (the handle, closing the door)
            h2 = [i for i, st in enumerate(hr) if st[0] == 'hold' and st[3] == '@shoulder_r' and i < hd]
            a0, a1 = h2[0], h2[-1]
            hr[a0:a1 + 1] = [('hold', hr[a0][1], hr[a1][2], *hang('Right', *EX.get('hang_r', (-0.02, 0.12, 0.47))))]
            n = a1 - a0
            if EX.get('hang_r2'):  # (outside, crouched: the hand moves off the knee to beside it)
                t0, t1, prm = EX['hang_r2']
                hr[a0:a0 + 1] = [hr[a0][:2] + (t0,) + hr[a0][3:], ('move', t0, t1, [], 0.0), ('hold', t1, hr[a0][2], *hang('Right', *prm))]
                n -= 2
            c.auto_contacts = {(sd, (kk - n if sd == 'Right' and kk > a1 else kk)): v for (sd, kk), v in c.auto_contacts.items()}
    if EX.get('seat_push', True):
        # (the right hand down on the seat's right bolster beside the hip, pushing off as the hips rise)
        sp2 = EX.get('push_at', V3(-0.20, 0.31, -0.02))
        hang_end = hr[2][2]
        hr[2] = hr[2][:2] + (EX.get('p0', 2.55),) + hr[2][3:]
        new = [('move', EX.get('p0', 2.55), EX.get('p1', 2.85), [], 0.0),
               ('hold', EX.get('p1', 2.85), EX.get('p2', 3.65), 'seat_driver', _seat_pt(c.veh, sp2), _seat_q(c.veh, hq(*EX.get('push_q', ((0.0, -1.0, 0.0), (0.0, 0.0, -1.0))))),
                _seat_pt(c.veh, sp2), _seat_dir(c.veh, V3(0.0, 1.0, 0.0)), 60)]
        hr[3] = ('move', EX.get('p2', 3.65)) + hr[3][2:]
        hr[3:3] = []
        c.hands['Right'] = hr[:3] + new + hr[3:]
        c.auto_contacts = {(sd, (kk + 2 if sd == 'Right' and kk >= 3 else kk)): v for (sd, kk), v in c.auto_contacts.items()}
        c.auto_contacts[('Right', 4)] = 'push'
    c.auto_contacts = {kk: v for kk, v in c.auto_contacts.items() if not kk[0].startswith('foot')}
    c.events['unseated'] = 4.0
    if EX.get('bskip'):
        c.balance_skip = (tuple(EX['bskip']),)
