"""Paths and the body / pack table for the Unreal export (pass R4). Plain Python (no bpy)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, '..', '..'))
CHAR = os.path.join(PROJECT, 'public', 'characters')
OUT = os.path.join(PROJECT, 'unreal')
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
SCRATCH = os.environ.get('R4_SCRATCH', os.path.join(os.environ.get('TMPDIR', '/tmp'), 'ar_rifle_demo_unreal_scratch'))

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
