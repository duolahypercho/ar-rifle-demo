"""Writes the per-body tables the GAME reads (pass R3) into public/characters/, from the clip
pipeline's per-body tables (blender/rifle_motion/bodies/*.json), the Tripo metrics and the R1
mapping. Plain Python, no Blender:

    python3 blender/bodies/game_tables.py

Outputs (the game never reads anything under blender/ at run time):
    public/characters/tripo-player-ue5.game.json   the Tripo player (frames: tripo-player-ue5.frames.json)
    public/characters/earthonline-ue5.game.json    the four EarthOnline -ue5 bodies (one table: they
                                                   share joints and frames; R = their rest world rotations)

Frames: "hand" = the old Hand joint frame (canonical: fingers -y, palm +z), "foot" = the old Foot
joint frame (canonical: world axes at the ankle), "toe" = the old ToeBase frame (from the ball
joint), "head" = the old Head frame, "chest" = spine_05 canonical; glTF axes (+x left, +y up, +z
forward), metres.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
BODIES = ROOT / 'blender' / 'rifle_motion' / 'bodies'
OUT = ROOT / 'public' / 'characters'

# R1's twist shares (blender/rifle_motion/skel.py TWIST): the EarthOnline -ue5 bodies' weights
R1_TWIST = {
    'upperarm_twist_01_{s}': {'parent': 'upperarm_{s}', 'share': -0.50, 'measure': 'self', 'source': 'upperarm_{s}'},
    'upperarm_twist_02_{s}': {'parent': 'upperarm_{s}', 'share': -0.25, 'measure': 'self', 'source': 'upperarm_{s}'},
    'lowerarm_twist_02_{s}': {'parent': 'lowerarm_{s}', 'share': 0.47, 'measure': 'child', 'source': 'hand_{s}'},
    'lowerarm_twist_01_{s}': {'parent': 'lowerarm_{s}', 'share': 0.88, 'measure': 'child', 'source': 'hand_{s}'},
    'thigh_twist_01_{s}': {'parent': 'thigh_{s}', 'share': -0.30, 'measure': 'self', 'source': 'thigh_{s}'},
    'thigh_twist_02_{s}': {'parent': 'thigh_{s}', 'share': -0.15, 'measure': 'self', 'source': 'thigh_{s}'},
    'calf_twist_02_{s}': {'parent': 'calf_{s}', 'share': 0.24, 'measure': 'child', 'source': 'foot_{s}'},
    'calf_twist_01_{s}': {'parent': 'calf_{s}', 'share': 0.44, 'measure': 'child', 'source': 'foot_{s}'},
}


def r(v, n=4):
    return [round(x, n) for x in v]


def game_table(t, *, name, note, frames, twist, index, face, atlas, label):
    legs = t['legs']
    ankle = legs['ankleY']
    heel = t['review']['heel']  # back of the heel, foot frame, 1 cm above the sole
    ball_y = t['review']['ballY']  # the ball joint above the sole standing flat
    toe_tip = t['rig']['toeTip']
    return {
        'name': name,
        'note': note,
        'label': label,
        'frames': frames,
        # skeleton-level data this body family needs: twist shares when there is no frames file
        'twistBones': twist,
        # the face layer: eye bones at the ball centres and the 16 morph targets (EarthOnline), or none
        'face': face,
        # EarthOnline's texture atlas (look.js dressBody reads its ORM channels); not for other bodies
        'atlas': atlas,
        # middle of the palm from the wrist (hand frame)
        'palm': t['palm'],
        'foot': {
            'ankle': ankle,
            'heel': heel,
            # sole points for the review: heel (foot frame, from the ankle) and ball / toe (toe frame,
            # from the ball joint)
            'heelSole': [[0, -ankle, heel[2]], [0.04, -ankle, heel[2] + 0.02], [-0.04, -ankle, heel[2] + 0.02]],
            'ballSole': [[0, -ball_y, 0], [0.045, -ball_y, 0], [-0.045, -ball_y, 0], [0, -ball_y + 0.003, toe_tip]],
            'arch': [0, -ankle, 0.03],
        },
        # how much further out each foot stands than on the old body (half the hip-width difference)
        'stanceOut': round(legs.get('widthAdd', 0.0) / 2, 4),
        # the trigger finger: its tip and the middle of its end pad in the end joint's frame
        'index': index,
        # the aiming eye: the point welded behind the sight (head frame; the old eye joint's place on
        # the EarthOnline bodies, the painted eye + the old weld offset on Tripo) and, where known,
        # the eye itself on the skin (head frame) for the review's cheek measure
        'eye': {'sight': t['sightEye']['Right'], 'surface': None},
        # the cheek weld (handling.py AimPose EYE_BACK / EYE_DOWN): the eye's place from the sight's
        # (gun frame) and the more for each 45 degrees aimed down
        'cheek': {'back': t['aim']['eyeBack'], 'down': t['aim']['eyeDown']},
        # the shoulder pocket across / up in the chest frame, and how far the pad beds in
        'pocket': {'x': t['aim']['pocket'][0], 'y': t['aim']['pocket'][1], 'press': 0.02},
        'guns': {
            gun: {
                'carrySlide': g['carrySlide'],
                'slideMax': None,
                'supportPole': g['pole']['Left'],
            }
            for gun, g in t['guns'].items()
        },
        'aimSupportPole': t['aim']['pole']['Left'],
    }


def main():
    eo = json.loads((BODIES / 'civilian-m-01-player-ue5.json').read_text())
    tr = json.loads((BODIES / 'tripo-player-ue5.json').read_text())
    metrics = json.loads((OUT / 'tripo-player-ue5.metrics.json').read_text())
    frames = json.loads((OUT / 'tripo-player-ue5.frames.json').read_text())

    e = game_table(
        eo, name='earthonline-ue5',
        note='The four EarthOnline -ue5 bodies (civilian-m-01-player, civilian-police-m-hero, civilian-f-02-hero, civilian-m-03-hero): one table, as they share joints and frames. Values are the ones src/ had hard-coded before pass R3. Written by blender/bodies/game_tables.py from blender/rifle_motion/bodies/civilian-m-01-player-ue5.json.',
        frames=None, twist=R1_TWIST, index={'tip': [0, -0.022, 0], 'pad': [0, -0.013, 0.006]},
        face=True, atlas=True, label='EarthOnline')
    e['guns']['rifle']['slideMax'] = 0.08
    e['guns']['shotgun']['slideMax'] = 0.13
    e['guns']['rifle']['supportPole'] = [0.28, -0.95, -0.1]  # the game's ELBOW_POLE.left before R3
    e['guns']['shotgun']['supportPole'] = [0.28, -0.95, -0.1]

    # Tripo's index: 03 joint to the skin tip 3.56 cm along the finger (metrics); tip and pad kept the
    # old body's share of it
    hand_r = frames['bones']['hand_r']['canonicalHead']
    i3 = frames['bones']['index_03_r']['canonicalHead']
    tip_in_hand = metrics['hands']['r']['fingers']['index']['tip_inHand']
    tip = [hand_r[k] + tip_in_hand[k] - i3[k] for k in range(3)]
    length = (tip[0] ** 2 + tip[1] ** 2 + tip[2] ** 2) ** 0.5
    head = frames['bones']['head']['canonicalHead']
    eye_r = metrics['eyes']['right']
    t = game_table(
        tr, name='tripo-player-ue5',
        note='The Tripo player body (blender/bodies/tripo). Written by blender/bodies/game_tables.py from blender/rifle_motion/bodies/tripo-player-ue5.json and tripo-player-ue5.metrics.json; twist shares and frames from tripo-player-ue5.frames.json.',
        frames='tripo-player-ue5.frames.json', twist=None,
        index={'tip': [0, round(-0.9 * length, 4), 0], 'pad': [0, round(-0.59 * length, 4), 0.006]},
        face=False, atlas=False, label='Tripo player')
    t['eye']['surface'] = r([eye_r[k] - head[k] for k in range(3)])
    # The cheek weld re-tuned in the game (pass R3, review cheekCm): with the clips' eyeBack (0, 0.05,
    # 0.13) the painted eye sat 2.8 cm above the sight line level, 4.7 aimed 45 down, 1.1 aimed 45 up
    # with the jaw on the comb; now 2.2 / 3.4 / 1.4 (rifle), the cheek still on the comb
    # Pass F2 (review cheekCm against the painted eye, and the head / neck skin inside the gun's mesh):
    # the head nodded 16 degrees forward over the stock (24 aimed 45 down), the stock brought to the
    # face in the pocket (lift / liftUp / liftDown, chest frame, m) and the weld point lowered; eye on
    # the sight line within 0.1 cm at level, 45 up and 45 down on the rifle (R3: 2.2 / 1.4 / 3.4)
    # (liftUp has no forward part: 1.5 cm forward in the pocket aimed up made the shotgun's support hand
    # jolt 4.0 in burstUp, R3 3.1)
    t['cheek'] = {'back': [0, 0.0315, 0.13], 'down': [0, -0.0161, 0.01], 'up': [0, 0.0192, -0.0033],
                  'nod': 16, 'nodDown': 8,
                  'lift': [0.0078, 0, -0.0043], 'liftUp': [0.0209, 0, 0], 'liftDown': [-0.0001, 0, -0.0014],
                  'note': 'F2 game tune (R3: back (0, 0.04, 0.13), down (0, 0, 0.01), up (0, 0.02, 0)); the clips were authored with back (0, 0.05, 0.13), down (0, 0.012, 0.01)'}
    t['guns']['rifle']['slideMax'] = 0.08
    t['guns']['shotgun']['slideMax'] = round(tr['guns']['shotgun']['carrySlide'] + 0.01, 3)
    for out, table in (('earthonline-ue5.game.json', e), ('tripo-player-ue5.game.json', t)):
        (OUT / out).write_text(json.dumps(table, indent=1) + '\n')
        print('wrote', OUT / out)


if __name__ == '__main__':
    main()
