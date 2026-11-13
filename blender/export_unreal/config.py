"""Paths and the body / pack table for the Unreal export (pass R4; vehicles pass U1). Plain Python (no bpy).

Every path is relative to this file (the project folder is two levels up), so nothing depends on where
the project lives or on the user's home folder; scratch files go under the system temp dir
(R4_SCRATCH overrides it).
"""
import math as _m
import os
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHAR = os.path.join(PROJECT, 'public', 'characters')
OUT = os.environ.get('R4_OUT', os.path.join(PROJECT, 'unreal'))   # (R4_OUT: a trial build elsewhere)
BLENDER = os.environ.get('R4_BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
SCRATCH = os.environ.get('R4_SCRATCH', os.path.join(tempfile.gettempdir(), 'ar_rifle_demo_unreal_scratch'))


def rel(path):
    """A path as written into logs and JSON: relative to the project folder."""
    return os.path.relpath(path, PROJECT)


# skeleton key -> clip pack, the body whose skeleton the animations are baked on, frames file
PACKS = {
    'tripo': {
        'pack': os.path.join(CHAR, 'rifle-motion-tripo-v1.glb'),
        'notes': os.path.join(CHAR, 'rifle-motion-tripo-v1.json'),
        'body': 'tripo-player-ue5',
        'frames': os.path.join(CHAR, 'tripo-player-ue5.frames.json'),
    },
    'earthonline': {
        'pack': os.path.join(CHAR, 'rifle-motion-ue5-v1.glb'),
        'notes': os.path.join(CHAR, 'rifle-motion-ue5-v1.json'),
        'body': 'civilian-m-01-player-ue5',
        'frames': None,   # I-pose bodies: R[b] = rest world rotation
    },
}

# Pass U1: the vehicle clip packs. Output folder animations/<pack key>/; `skeleton` = the PACKS key whose
# skeleton (body, frames, Gun / GunIn rests) the clips are baked on, so the bone set and rests are those
# of bodies/*.fbx. Clip space = the vehicle root's glTF frame (VEHICLE_NOTES.md, design decisions).
VEHICLE_PACKS = {
    'tripo-vehicle': {
        'skeleton': 'tripo',
        'pack': os.path.join(CHAR, 'vehicle-motion-tripo-v1.glb'),
        'notes': os.path.join(CHAR, 'vehicle-motion-tripo-v1.json'),
    },
    'earthonline-vehicle': {
        'skeleton': 'earthonline',
        'pack': os.path.join(CHAR, 'vehicle-motion-ue5-v1.glb'),
        'notes': os.path.join(CHAR, 'vehicle-motion-ue5-v1.json'),
    },
}


def pack_cfg(key):
    """Clip-pack table entry for a rifle pack key or a vehicle pack key (with 'skeleton')."""
    if key in PACKS:
        return dict(PACKS[key], skeleton=key)
    v = VEHICLE_PACKS[key]
    return dict(PACKS[v['skeleton']], pack=v['pack'], notes=v['notes'], skeleton=v['skeleton'])


# body -> skeleton key
BODIES = {
    'tripo-player-ue5': 'tripo',
    'civilian-m-01-player-ue5': 'earthonline',
    'civilian-police-m-hero-ue5': 'earthonline',
    'civilian-f-02-hero-ue5': 'earthonline',
    'civilian-m-03-hero-ue5': 'earthonline',
}

# The body GLB each export reads. Default public/characters/<body>.glb. Pass F1: the game's Tripo copy
# carries reduced textures (4096 base colour, 2048 normal / roughness-metal; blender/bodies/game_copy.py),
# so the Unreal export reads the full-resolution master instead (same skeleton, mesh and weights).
BODY_SOURCE = {
    'tripo-player-ue5': os.path.join(PROJECT, 'blender', 'bodies', 'tripo', 'tripo-player-ue5.glb'),
}


def body_glb(name):
    return BODY_SOURCE.get(name, os.path.join(CHAR, name + '.glb'))


APOSE = os.path.join(PROJECT, 'blender', 'ue5_rig', 'ue5_mapping.json')

GUNS = {
    'ar_rifle': {'glb': os.path.join(PROJECT, 'public', 'ar_rifle.glb'), 'butt': 'stock'},
    'pump_shotgun': {'glb': os.path.join(PROJECT, 'public', 'pump_shotgun.glb'), 'butt': 'butt_pad'},
}

# Extra bones added to both skeletons (leaf bones under spine_05), and the clip / frame that gives
# each its rest (bind) transform.
EXTRA_BONES = {
    'Gun': ('rifle-hold-low', 0),        # the low ready hold
    'GunIn': ('swap-shotgun-rifle', 0),  # the rifle's slung place on the back (where a swap draws it)
}
EXTRA_PARENT = 'spine_05'
DROPPED_HELPERS = ['PalmL', 'PalmR', 'ElbowL', 'ElbowR']

PROOF_CLIPS = ['rifle-walk-f', 'rifle-sprint', 'rifle-aim-level', 'reload-rifle-tac', 'reload-rifle-empty',
               'swap-rifle-shotgun', 'rifle-jog-start', 'rifle-pivot-l180', 'rifle-run-turn-l',
               'rifle-crouch-walk-f', 'hit-heavy-f', 'shotgun-pump', 'rifle-idle', 'swap-shotgun-rifle']

# ------------------------------------------------------------------ pass U1: vehicles

# The game's copies (public/vehicles/, LOD0 geometry, textures shrunk by blender/vehicles/shrink_textures.py);
# node names and transforms are those of the originals the clips were fitted against (checked in U1: equal).
# `kind` = the clip packs' vehicle name (notes clips[*].vehicle, vehicleFit keys).
VEHICLES = {
    'supercar': {'glb': os.path.join(PROJECT, 'public', 'vehicles', 'supercar.glb'), 'kind': 'car',
                 'root': 'vehicle_root'},
    'utility_helicopter': {'glb': os.path.join(PROJECT, 'public', 'vehicles', 'utility_helicopter.glb'), 'kind': 'heli',
                           'root': 'helicopter_root'},
}
VEHICLE_OF_KIND = {v['kind']: k for k, v in VEHICLES.items()}

# The moving parts and their controls, as the clip pass defines them (blender/vehicle_motion/vehicles.py; also the
# packs' notes `controls`), in each node's own glTF frame. door: 0 shut .. 1 open.
DOOR = {'car': ('door_L', 55.0), 'heli': ('cockpit_door_R', 68.0)}
CYCLIC_DEG = {'fwd': 9.0, 'back': 6.0, 'side': 6.0}
COLLECTIVE_DEG = {'down': 4.0, 'up': 20.0, 'fly': 13.0}
PEDAL_M = 0.045
WHEEL_DEG = 90.0

# Per clip, the controls the clip was authored against (constants, or a function of t in seconds), as set in
# blender/vehicle_motion/clips_car.py and clips_heli.py. The door comes per frame from the notes' `door`.
# Only car-drive (wheel) and heli-fly (cyclic, pedals) move a control other than the door.

def _car_drive_wheel(t):
    return 2.5 * _m.sin(2 * _m.pi * t / 8.0) + 1.2 * _m.sin(2 * _m.pi * 3 * t / 8.0 + 0.7) - 1.2 * _m.sin(0.7)


def _heli_fly_fwd(t):
    return 0.8 * _m.sin(2 * _m.pi * t / 8.0 + 0.3) - 0.8 * _m.sin(0.3) + 0.4 * _m.sin(2 * _m.pi * 3 * t / 8.0)


def _heli_fly_right(t):
    return 0.6 * _m.sin(2 * _m.pi * 2 * t / 8.0 + 1.0) - 0.6 * _m.sin(1.0)


def _heli_fly_pedal(t):
    return 0.004 * _m.sin(2 * _m.pi * t / 8.0)


_HELI = {'fwd': 0.0, 'right': 0.0, 'coll': COLLECTIVE_DEG['fly'], 'pedal': 0.0}
CLIP_CONTROLS = {
    'car-drive': {'wheel': _car_drive_wheel},
    'car-steer-l': {'wheel': WHEEL_DEG},
    'car-steer-r': {'wheel': -WHEEL_DEG},
    'car-look-back': {'wheel': 0.0},
    'car-enter': {'wheel': 0.0},
    'car-exit': {'wheel': 0.0},
    'heli-fly': dict(_HELI, fwd=_heli_fly_fwd, right=_heli_fly_right, pedal=_heli_fly_pedal),
    'heli-cyclic-f': dict(_HELI, fwd=CYCLIC_DEG['fwd']),
    'heli-cyclic-b': dict(_HELI, fwd=-CYCLIC_DEG['back']),
    'heli-cyclic-l': dict(_HELI, right=-CYCLIC_DEG['side']),
    'heli-cyclic-r': dict(_HELI, right=CYCLIC_DEG['side']),
    'heli-collective-up': dict(_HELI, coll=COLLECTIVE_DEG['up']),
    'heli-collective-down': dict(_HELI, coll=COLLECTIVE_DEG['down']),
    'heli-pedal-l': dict(_HELI, pedal=PEDAL_M),
    'heli-pedal-r': dict(_HELI, pedal=-PEDAL_M),
    'heli-enter': dict(_HELI, coll=COLLECTIVE_DEG['down']),
    'heli-exit': dict(_HELI, coll=COLLECTIVE_DEG['down']),
}
CONTROL_NAMES = {'car': ['door', 'wheel'], 'heli': ['door', 'fwd', 'right', 'coll', 'pedal']}
