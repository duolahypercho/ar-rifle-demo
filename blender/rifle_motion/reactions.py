"""Hit reactions, authored: a light flinch from the front, back, left or right (0.4 s) and a heavy
stagger from the front or back (0.9 s).

Like the handling clips (handling.py), each starts and ends on rifle-hold-low's trunk and the low
ready, both hands on the gun throughout, so the game lays it over whatever is playing as a difference
from that hold: the trunk's, and the gun's (character.js hit layer). The legs here just stand; the
stagger's step back or forward is the game's (player.js hit: the body is shoved and the feet step
after it).

The struck part goes first: hit in the chest from the front, the chest is driven back and the head,
which hangs on the neck, comes forward against it and then follows a few hundredths of a second late;
from the side the near shoulder goes back and the trunk rolls away; from behind the hips are driven
under and the chest and head whip back after them. The gun is knocked off line with the trunk and a
little more (the hands are slow to stiffen), then brought back onto the low ready, a touch past and
settle.
"""
from mathutils import Vector

from .handling import DEG, Clip, Hand, Keys
from .skel import ypr

# Per direction (where the blow comes from), at the peak of the recoil, in degrees and metres on top
# of the hold: lean (+ forward), turn (+ to the left), roll (+ the left shoulder down), the head's
# lag (look_pitch, look_yaw), the gun knocked (yaw, pitch, roll off the low ready's turn; butt moved)
LIGHT = {
    'f': dict(lean=-7.0, turn=2.0, roll=0.0, look_pitch=9.0, look_yaw=0.0, gun=(2.0, -6.0, 3.0), butt=(0.0, 0.012, -0.02)),
    'b': dict(lean=6.0, turn=-1.5, roll=0.0, look_pitch=-10.0, look_yaw=0.0, gun=(-2.0, 6.0, -2.0), butt=(0.0, -0.008, 0.02)),
    'l': dict(lean=-1.0, turn=-8.0, roll=-6.0, look_pitch=2.0, look_yaw=10.0, gun=(-7.0, 2.0, 5.0), butt=(-0.02, 0.006, 0.0)),
    'r': dict(lean=-1.0, turn=8.0, roll=6.0, look_pitch=2.0, look_yaw=-10.0, gun=(7.0, 2.0, -5.0), butt=(0.02, 0.006, 0.0)),
}
LIGHT_SECONDS, HEAVY_SECONDS = 0.4, 0.9
HEAVY = {d: dict({k: v * 2.0 for k, v in LIGHT[d].items() if not isinstance(v, tuple)},
                 gun=tuple(x * 1.8 for x in LIGHT[d]['gun']), butt=tuple(x * 1.6 for x in LIGHT[d]['butt']))
         for d in ('f', 'b')}


class Hit(Clip):
    def __init__(self, author, carry, carry2, stance, way, heavy):
        super().__init__(author, carry, carry2, stance)
        self.way, self.heavy = way, heavy

    def make(self):
        c = self.carry
        p = (HEAVY if self.heavy else LIGHT)[self.way]
        end = HEAVY_SECONDS if self.heavy else LIGHT_SECONDS
        # the timing: struck at 0, the trunk's peak, the rebound past the hold, settled at the end
        if self.heavy:
            peak, head, back, settle = 0.12, 0.17, 0.42, 0.66
        else:
            peak, head, back, settle = 0.06, 0.1, 0.19, 0.3

        def curve(amount, at, over=-0.25):
            # 0 -> amount at `at` (hard: the blow) -> `over` of it the other way -> rest
            return Keys([(0.0, 0.0), (at, amount, 'stop'), (back + (at - peak), amount * over), (settle, amount * over * 0.2), (end, 0.0)])

        lean, turn, roll = curve(p['lean'], peak), curve(p['turn'], peak), curve(p['roll'], peak)
        # the head: first carried the other way by the trunk going out from under it, then after it
        look_p = Keys([(0.0, 0.0), (peak * 0.6, p['look_pitch'], 'stop'), (head, -p['look_pitch'] * 0.3), (back + 0.04, p['look_pitch'] * 0.15),
                       (end, 0.0)])
        look_y = Keys([(0.0, 0.0), (peak * 0.6, p['look_yaw'], 'stop'), (head, -p['look_yaw'] * 0.3), (end, 0.0)])
        # the weight: knocked down a little, and a heavy blow folds the knees (the step is the game's)
        dip = Keys([(0.0, 0.0), (peak, 0.006 if not self.heavy else 0.03, 'stop'), (back, 0.002 if not self.heavy else 0.012), (end, 0.0)])
        sway_x = {'l': -0.01, 'r': 0.01}.get(self.way, 0.0) * (2 if self.heavy else 1)
        sway = Keys([(0.0, 0.0), (peak + 0.02, sway_x, 'stop'), (end, 0.0)])

        def trunk(t):
            return dict(lean=lean(t), turn=turn(t), roll=roll(t), look_pitch=look_p(t), look_yaw=look_y(t), dip=dip(t), sway=sway(t),
                        collar={'clavicle_l': (0.0, 2.0 * lean(t) / max(1.0, abs(p['lean']))), 'clavicle_r': (0.0, -2.0 * lean(t) / max(1.0, abs(p['lean'])))})

        low_at, low_q = self.low()
        gy, gp, gr = p['gun']
        # the gun lags the trunk by a frame or two, and is brought back with a small overshoot
        g_at = Keys([(0.0, low_at), (peak + 0.03, low_at + Vector(p['butt']), 'stop'), (back + 0.04, low_at - Vector(p['butt']) * 0.2), (end, low_at, 'stop')])
        g_x = Keys([(0.0, Vector((0.0, 0.0, 0.0))), (peak + 0.03, Vector((gy, gp, gr)), 'stop'), (back + 0.04, Vector((gy, gp, gr)) * -0.2), (end, Vector((0.0, 0.0, 0.0)))])
        stow = self.stow(self.carry2)

        def guns(t):
            d = g_x(t) * DEG
            return {'gun': (g_at(t), ypr(d.x, d.y, d.z) @ low_q), 'gun2': stow}

        main, sup = self.spot(c, 'main'), self.spot(c, 'support')
        hands = {'Right': Hand('Right', [('hold', 0.0, end, 'gun', main)]), 'Left': Hand('Left', [('hold', 0.0, end, 'gun', sup)])}
        frames, meta = self.build(end, trunk, guns, hands, lambda t: {'Left': c.pole['Left'], 'Right': c.pole['Right']},
                                  lambda t: {'Left': 1.0, 'Right': 1.0})
        meta['events'] = {'peak': peak, 'end': end}
        meta['nodes'] = ['PalmL', 'PalmR', 'ElbowL', 'ElbowR']
        meta['hit'] = dict(way=self.way, heavy=self.heavy)
        return frames, meta


CLIPS = {f'hit-light-{d}': (d, False) for d in LIGHT}
CLIPS.update({f'hit-heavy-{d}': (d, True) for d in HEAVY})
