"""Vehicle fit per body family (vehicles.FIT): the adjustments a driver / pilot of this body makes with the
vehicle's own adjusters, as fixed translations in each node's parent frame (V: vehicle root), with why.

Limits the coordinator set (pass A1 follow-up): supercar seat_driver forward <= 0.20 m, down <= 0.03 m;
steering_wheel towards the driver along its column <= 0.06 m. Helicopter pedal_L / pedal_R aft <= 0.25 m;
pilot_seat forward <= 0.08 m. A seat's helper point moves with the seat.
"""
import math

# the steering wheel's column (glTF local +Y of steering_wheel in V): rest rotation Rx(68 deg)
_COL = (0.0, math.cos(math.radians(68.0)), math.sin(math.radians(68.0)))


def _col(m):
    return [round(c * m, 5) for c in _COL]


UE5_WHEEL = 0.03
UE5_SEAT_FWD = 0.145
UE5_SEAT_DOWN = 0.06  # (pass A3 round 2: its thighs 6.55 cm into the cushion at the shared seated pose)
TRIPO_SEAT_FWD = 0.145

FITS = {
    'tripo-player-ue5': {
        'car': {
            'seat_driver': dict(translate=[0.0, -0.03, -0.20], why='seat slid fully forward on its rails (0.20 m) and down (0.03 m)'),
            'seat_driver_point': dict(translate=[0.0, -0.03, -0.20], why='moves with the seat'),
            'steering_wheel': dict(translate=_col(0.06), why='wheel telescoped 0.06 m towards the driver along its column'),
        },
        'heli': {
            'pedal_L': dict(translate=[0.0, 0.0, 0.25], why='pedal adjuster: pedals 0.25 m aft'),
            'pedal_R': dict(translate=[0.0, 0.0, 0.25], why='pedal adjuster: pedals 0.25 m aft'),
            'pilot_seat': dict(translate=[0.0, 0.0, -TRIPO_SEAT_FWD], why='seat %.3f m forward: the backrest against the back as the hands hold the controls (pass A3)' % TRIPO_SEAT_FWD),
            'seat_pilot_point': dict(translate=[0.0, 0.0, -TRIPO_SEAT_FWD], why='moves with the seat'),
        },
    },
}
# (pass A2) the EarthOnline bodies (civilian-m-01-player-ue5 and the three roster bodies on its joints): legs 0.78 m
# (thigh 0.38 + shin 0.40) against Tripo's 0.82, so the seat and the pedals stay at their forward / aft limits;
# the arms reach the wheel with the elbows bent ~10 deg more than Tripo's at the Tripo setting, so the wheel is
# telescoped out less
FITS['civilian-m-01-player-ue5'] = {
    'car': {
        'seat_driver': dict(translate=[0.0, -0.03, -0.20], why='legs 0.78 m: seat slid fully forward on its rails (0.20 m) and down (0.03 m)'),
        'seat_driver_point': dict(translate=[0.0, -0.03, -0.20], why='moves with the seat'),
        'steering_wheel': dict(translate=_col(UE5_WHEEL), why='wheel telescoped %.2f m towards the driver along its column' % UE5_WHEEL),
    },
    'heli': {
        'pedal_L': dict(translate=[0.0, 0.0, 0.25], why='legs 0.78 m: pedal adjuster at its aft limit, 0.25 m'),
        'pedal_R': dict(translate=[0.0, 0.0, 0.25], why='legs 0.78 m: pedal adjuster at its aft limit, 0.25 m'),
        'pilot_seat': dict(translate=[0.0, -UE5_SEAT_DOWN, -UE5_SEAT_FWD], why='seat %.3f m forward: the backrest against the back as the hands hold the controls (pass A3); %.3f m down: its thighs off the cushion\'s front (pass A3 round 2)' % (UE5_SEAT_FWD, UE5_SEAT_DOWN)),
        'seat_pilot_point': dict(translate=[0.0, -UE5_SEAT_DOWN, -UE5_SEAT_FWD], why='moves with the seat'),
    },
}
