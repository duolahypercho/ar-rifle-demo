"""Builds public/characters/rifle-motion-ue5-v1.glb and .json on the UE5 Mannequin-style skeleton
(earthonline-ue5-v1, blender/ue5_rig/UE5_SKELETON.md; clips authored in canonical frames, see
rifle_motion/skel.py): the carry (the low and high ready as
one-frame holds), the rifle idle, the 8-way tactical walk and jog and the sprint, each clip with
the gun's own track; and the gun handling (rifle_motion/handling.py): the weapon swap both ways,
the reloads, the shotgun's pump and the aiming poses of both guns; the hit reactions
(rifle_motion/reactions.py); the belt kit the reloads draw from (rifle_motion/pouch.py).

Run it in this project's Blender (see blender/tools), or headless:

  python3 blender/tools/bl.py run blender/build_rifle_motion.py
  blender --background --python blender/build_rifle_motion.py

It first plays some of the clips with the shotgun in the hands and judges them (the same Gun
track carries both guns). Then it rebuilds the scene from scratch with the rifle (character,
gun, control rig: rifle_motion/rig.py), keys every clip onto the rig's controls
(rifle_motion/gait.py, keys.py, the carry in carry.py), bakes what the skeleton does to plain
keys at 30 fps (bake.py), judges each clip (review.py: numbers in blender/review/ue5/clips.txt,
contact sheets in blender/review/ue5/*.png), exports, and saves blender/rifle_motion_ue5.blend.
Reads only the body GLB below (and rifle_motion/ue5_data.json, the finger grip and sight-eye points,
converted once from the old files); nothing from the old skeleton. The
handling clips are made in the scene of the gun that is in the hands at their start. Set
ONLY = ['rifle-walk-f', 'swap-shotgun-rifle', ...] before running it to judge a few clips without
exporting; with PATCH = True as well, those clips are re-exported into the existing GLB and JSON in
place (same channels and frame counts only; quicker than a full build for a change to a few clips).
"""
import importlib
import json
import math
import pathlib
import sys

import bpy
from mathutils import Vector

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from rifle_motion import body  # noqa: E402

# The one place the body is chosen: its GLB (joint positions, hierarchy, rest frames), its frames
# JSON giving each bone's R[b] (None: <body>.frames.json beside the GLB if present, else the rest
# world rotations, right for the EarthOnline I-pose bodies), and its table of measurements
# (rifle_motion/bodies/<TABLE>.json: palm, legs, feet, stance, holds, aim, pouch...). A run may set
# BODY_NAME = 'tripo' before running this file, and OVERRIDES = {...} for any of BODY, FRAMES,
# TABLE, VERSION, BLEND (REVIEW_DIR and OUT_GLB may be set on their own).
BODIES = {
    'player': dict(BODY=ROOT / 'public/characters/civilian-m-01-player-ue5.glb', FRAMES=None, TABLE='civilian-m-01-player-ue5',
                   VERSION='rifle-motion-ue5-v1', REVIEW_DIR=HERE / 'review/ue5', BLEND=HERE / 'rifle_motion_ue5.blend'),
    'tripo': dict(BODY=HERE / 'bodies/tripo/tripo-player-ue5.glb', FRAMES=HERE / 'bodies/tripo/tripo_frames.json', TABLE='tripo-player-ue5',
                  VERSION='rifle-motion-tripo-v1', REVIEW_DIR=HERE / 'review/tripo', BLEND=HERE / 'rifle_motion_tripo.blend'),
}
_CHOICE = dict(BODIES[globals().get('BODY_NAME', 'player')])
_CHOICE.update(globals().get('OVERRIDES') or {})
importlib.reload(body)
body.select(_CHOICE['TABLE'])
from rifle_motion import bake, carry, closeups, crouch, gait, gltfio, handling, keys, pouch, reactions, review, rig, skel, transitions  # noqa: E402

for module in (gltfio, skel, carry, pouch, rig, gait, crouch, transitions, handling, reactions, keys, bake, review, closeups):
    importlib.reload(module)

BODY, FRAMES, VERSION, BLEND = _CHOICE['BODY'], _CHOICE['FRAMES'], _CHOICE['VERSION'], _CHOICE['BLEND']
OUT_GLB = pathlib.Path(globals().get('OUT_GLB', ROOT / f'public/characters/{VERSION}.glb'))
OUT_JSON = OUT_GLB.with_suffix('.json')
REVIEW = pathlib.Path(globals().get('REVIEW_DIR', _CHOICE['REVIEW_DIR']))
# the review's mesh tests and sheets with the twist bones keyed (as the pack has them)
REVIEW_TWIST = globals().get('REVIEW_TWIST', True)

# The standing stance (model space: +X left, +Z forward): the game's rest stance (character.js
# STANCE, 60 % of the way from relaxed to combat), left foot forward, right foot back and out.
# (per body: rifle_motion/bodies/<body>.json `stance`)
STANCE = {k: (Vector(v[0]), v[1]) for k, v in body.T['stance'].items()}
DIRECTIONS = ('f', 'fl', 'l', 'bl', 'b', 'br', 'r', 'fr')
WALKS = [f'rifle-walk-{d}' for d in DIRECTIONS]
JOGS = [f'rifle-jog-{d}' for d in DIRECTIONS]
# Transitions (rifle_motion/transitions.py): turning on the spot, setting off, stopping and the
# running about-turn, each moving the body over the ground (a root track in its notes).
PIVOTS = [f'rifle-pivot-{side}{angle}' for side in 'lr' for angle in transitions.PIVOT_SECONDS]
# Stops begin wherever the stride is when the key is let go: one per eighth of the loop's cycle.
STOPS = [f'rifle-{g}-stop-{k}' for g in ('walk', 'jog') for k in range(transitions.STOP_ENTRIES)]
TRANSITIONS = PIVOTS + ['rifle-walk-start', 'rifle-jog-start'] + STOPS + ['rifle-run-turn-l', 'rifle-run-turn-r']
# The tactical crouch (rifle_motion/crouch.py): its idle, its walk in eight directions, and going
# down into it and back up.
CROUCH = ['rifle-crouch-idle'] + [f'rifle-crouch-walk-{d}' for d in DIRECTIONS] + ['rifle-crouch-down', 'rifle-crouch-up']
CLIPS = ['rifle-idle', 'rifle-hold-low', 'rifle-hold-high'] + WALKS + JOGS + ['rifle-sprint'] + TRANSITIONS + CROUCH
# The shotgun is carried on the same Gun track: these clips are played with it in the hands and
# judged the same way (not exported).
SHOTGUN = ['rifle-idle', 'rifle-hold-low', 'rifle-hold-high', 'rifle-walk-f', 'rifle-walk-l', 'rifle-walk-b']
# The handling clips, by the gun in the hands at their start (exported, both guns).
AIMS = ('level', 'up', 'down')
AIM_PITCH = {'level': 0.0, 'up': 45.0, 'down': -45.0}
HANDLING = {
    'rifle': ['swap-rifle-shotgun', 'reload-rifle-tac', 'reload-rifle-empty'] + [f'rifle-aim-{a}' for a in AIMS] + list(reactions.CLIPS),
    'shotgun': ['swap-shotgun-rifle', 'reload-shotgun-start', 'reload-shotgun-shell', 'reload-shotgun-end', 'reload-shotgun-end-pump',
                'shotgun-pump'] + [f'shotgun-aim-{a}' for a in AIMS],
}
# Close-up sheets (rifle_motion/closeups.py) rendered after a clip is judged: clip -> [(frame or
# 'max-shrug', views)], into REVIEW/close-<prefix><clip>-<frame>.png. Set CLOSEUPS = {...} before a
# run to change them.
HANDS = ('grip-right', 'grip-left', 'grip-below', 'support-right', 'support-left', 'support-below')
CLOSEUPS = globals().get('CLOSEUPS') or {
    'rifle-hold-low': [(0, HANDS + ('back',))],
    'rifle-aim-level': [(0, HANDS + ('cheek-front', 'cheek-side', 'cheek-top'))],
    'rifle-aim-up': [(0, ('cheek-front', 'cheek-side', 'grip-right', 'support-left'))],
    'rifle-aim-down': [(0, ('cheek-front', 'cheek-side', 'grip-right', 'support-left'))],
    'shotgun-aim-level': [(0, HANDS + ('cheek-front', 'cheek-side', 'cheek-top'))],
    'swap-rifle-shotgun': [('max-shrug', ('back', 'back-high', 'right', 'left'))],
    'reload-rifle-tac': [('draw', ('pouch', 'pouch-front', 'support-below'))],
    'reload-shotgun-shell': [('draw', ('pouch', 'pouch-front', 'support-below'))],
}
# where the slung gun is tested against the body besides the handling clips
SLUNG = ('rifle-idle', 'rifle-hold-low', 'rifle-walk-f', 'rifle-walk-l', 'rifle-jog-f', 'rifle-sprint')
# The ways of carrying the gun that src/alive.js puts on top of the clips' hold at rest (its
# CARRIES: yaw, pitch, roll in rad, drop in m; the support hand's small slide is left out here):
# each is checked against the posed body on rifle-hold-low, so the game's clearance need not push.
FIDGETS = {'relaxed': (0.04, 0.1, -0.03, 0.015), 'higher': (-0.04, -0.1, 0.03, -0.005), 'canted': (0.05, 0.03, -0.1, 0.01)}


def make(author, name, scn=None):
    guns = (author, scn['carry'], scn['carry2'], STANCE) if scn else None
    if name in reactions.CLIPS:
        return reactions.Hit(*guns, *reactions.CLIPS[name]).make()
    if name == 'rifle-crouch-idle':
        return crouch.crouch_idle(author, STANCE)
    if name.startswith('rifle-crouch-walk-'):
        return crouch.crouch_walk(author, name.split('-')[-1])
    if name in ('rifle-crouch-down', 'rifle-crouch-up'):
        return crouch.crouch_change(author, STANCE, name.endswith('-down'))
    if name.startswith('swap-'):
        return handling.Swap(*guns).make()
    if name.startswith('reload-rifle-'):
        return handling.RifleReload(*guns, name.endswith('empty')).make()
    if '-aim-' in name:
        return handling.AimPose(*guns, AIM_PITCH[name.split('-')[-1]]).make()
    if name in handling.SHOTGUN_CLIPS:
        return handling.SHOTGUN_CLIPS[name](*guns).make()
    if name.startswith('rifle-pivot-'):
        key = name.split('-')[-1]
        return transitions.pivot(author, STANCE, int(key[1:]) * (1 if key[0] == 'l' else -1))
    if name.startswith('rifle-run-turn-'):
        return transitions.run_turn(author, 1 if name.endswith('-l') else -1, author.jog('f')[1])
    if name.endswith('-start') or '-stop-' in name:
        gait_name = name.split('-')[1]
        loop = author.walk('f') if gait_name == 'walk' else author.jog('f')
        if name.endswith('-start'):
            return transitions.start(author, STANCE, gait_name, loop[1])
        return transitions.stop(author, STANCE, gait_name, int(name.split('-')[-1]), loop)
    if name == 'rifle-idle':
        return author.idle(STANCE)
    if name.startswith('rifle-hold-'):
        return author.hold(name.split('-')[-1], STANCE)
    if name == 'rifle-sprint':
        return author.sprint()
    if name.startswith('rifle-jog-'):
        return author.jog(name.split('-')[-1])
    return author.walk(name.split('-')[-1])


def scene_for(gun, skeleton, fingers):
    scn = rig.build(BODY, gun, skeleton)
    scn['skel'] = skeleton
    author = gait.Author(skeleton, fingers, scn['carry'])
    mesh_test = review.MeshTest(scn['body'], scn['gun']['meshes'], scn['gun']['pad'], scn['gun2']['meshes'])
    sheets = review.Sheets(bpy.context.scene, REVIEW, [scn['rig']] + [o for o in bpy.data.objects if o.name.startswith('Icosphere')])
    return scn, author, mesh_test, sheets


def judge(scn, author, mesh_test, sheets, name, idle_hips, prefix=''):
    """Keys, bakes, measures and draws one clip. Returns (baked frames, meta, numbers)."""
    scene = bpy.context.scene
    frames, meta = make(author, name, scn)
    action = keys.key_clip(scn, scn['skel'], name, frames)
    baked = bake.bake(scene, scn, action, meta['frames'])
    # the twist bones as the pack will have them, so the mesh tests and sheets see the new body
    # (REVIEW_TWIST = False: at rest, the body deforming as the old one did)
    if REVIEW_TWIST:
        bake.key_twist(scn, name, bake.gltf_frames(scn['skel'], baked + baked[:1] if meta['loop'] else baked))
    handled = 'track' in meta
    grips = [f['grip'] for f in frames] if handled else None
    numbers = review.metrics(baked, meta, scn['carry'], idle_hips, grips, scn['carry2'])
    if globals().get('DIAG'):  # (fitting: a callable given the clip's frames, meta, bake and scene)
        globals()['DIAG'](name, frames, meta, baked, scn)
    if globals().get('WHERE'):  # (fitting: the frames where a hand misses its grip or an elbow is straight)
        for i, f in enumerate(baked):
            for side in ('Left', 'Right'):
                g = (grips[i] if grips else {}).get(side)
                bend = review.arms(f)[side][0]
                miss = 0.0
                if g:
                    c = scn['carry'] if g[0] == 'gun' else scn['carry2']
                    want = c.point({'butt': f[g[0]][0], 'quat': f[g[0]][1]}, g[1])
                    hb = skel.bone(side, 'hand')
                    miss = ((f['pos'][hb] + f['rot'][hb] @ carry.PALM_LOCAL) - want).length * 100
                if bend < 20 or miss > 0.3:
                    print(f'WHERE {name} frame {i} {side}: elbow {bend:.0f}, miss {miss:.2f} cm on {g and g[0]}')
    n = meta['frames']
    # a handling clip is tested in every frame, with both guns and each against the other
    tests = range(n) if handled else sorted({round(i * n / 12) % n for i in range(12)})
    slung = handled or name in SLUNG
    hits, clear, clear2, touch, limit, limit2 = {}, None, None, 0, None, None
    low = carry.HOLDS['low']['at']
    for f in tests:
        scene.frame_set(f)
        pose = bake.read_pose(scn['skeleton'], scn['skel'], scn['mount'], scn['mount2'])
        # (a butt pad only beds into the shoulder at the hold)
        bedded = not handled or (pose['gunLocal'][0] - scn['carry'].shift - low).length < 0.05
        bare, cm = mesh_test.clearance(pose['gun'], bedded)
        if slung:
            held = handled and any((frames[f]['grip'].get(s) or ('',))[0] == 'gun2' for s in ('Left', 'Right'))
            bare2, cm2 = mesh_test.slung_clearance(pose['gun2'], held)
            bare.update(bare2)
            if clear2 is None or cm2 < clear2:
                limit2 = getattr(mesh_test, 'limit2', None)
            clear2 = cm2 if clear2 is None else min(clear2, cm2)
            if handled:
                touch += mesh_test.guns_touch()
        for k, v in bare.items():
            hits[k] = hits.get(k, 0) + v
        if globals().get('HITS_PER_FRAME') and bare:  # (fitting: where the guns go through the body)
            print(f'HITS {name} frame {f}: {bare}')
        if clear is None or cm < clear:
            limit = getattr(mesh_test, 'limit', None) if not bare else None
        clear = cm if clear is None else min(clear, cm)
    numbers.update(gunHits=hits or 0, gunClearCm=clear)
    if limit and clear is not None and clear < 3.0:
        numbers.update(clearBy=limit)
    if slung:
        numbers.update(slungClearCm=clear2)
        if limit2 and clear2 is not None and clear2 < 3.0:
            numbers.update(slungBy=limit2)
    if handled:
        numbers.update(gunsTouch=touch, snap30=review.jumps(baked))
    if not meta['loop']:  # a handling clip or a transition: first frame to last
        picks = sorted({round(i * (n - 1) / (11 if handled else 9)) for i in range(12 if handled else 10)})
    else:
        picks = sorted({round(i * n / 10) % n for i in range(10)})
    if globals().get('NO_SHEETS'):  # (fitting: numbers only)
        return baked, meta, numbers
    sheets.follow(meta.get('root'))
    sheets.render(prefix + name, picks, views=('front', 'side', 'back', 'top', 'hands') if handled else review.GAIT_VIEWS)
    for at, views in CLOSEUPS.get(prefix + name, ()):
        if at == 'max-shrug':  # the frame the collarbones are raised or drawn furthest
            at = max(range(n), key=lambda i: max(baked[i]['local'][c].rotation_difference(baked[0]['local'][c]).angle for c in ('clavicle_l', 'clavicle_r')))
        elif at == 'draw':  # the frame the support hand's palm is nearest the pouch's draw point
            gun = 'shotgun' if 'shotgun' in name else 'rifle'
            at = min(range(n), key=lambda i: (baked[i]['pos']['hand_l'] + baked[i]['rot']['hand_l'] @ carry.PALM_LOCAL
                                              - baked[i]['pos']['pelvis'] - baked[i]['rot']['pelvis'] @ pouch.DRAW[gun]).length)
        closeups.render(scene, scn['skeleton'], REVIEW / f'close-{prefix}{name}-{at}.png', at, views)
    return baked, meta, numbers


def fidget_check(scn, author, mesh_test, label):
    """rifle-hold-low with each of alive.js's carry offsets: report lines."""
    lines = []
    for name, (yaw, pitch, roll, drop) in FIDGETS.items():
        frames, meta = author.hold('low', STANCE)
        offset = (math.degrees(yaw), math.degrees(pitch), math.degrees(roll), Vector((0, -drop, 0)))
        author._gun(frames, offsets=[offset])
        keys.key_clip(scn, scn['skel'], 'fidget-' + name, frames)
        bake.clear_twist(scn['skeleton'], scn['skel'])
        bpy.context.scene.frame_set(0)
        pose = bake.read_pose(scn['skeleton'], scn['skel'], scn['mount'], scn['mount2'])
        if REVIEW_TWIST:
            bake.key_twist(scn, 'fidget-' + name, bake.gltf_frames(scn['skel'], [pose]))
        bpy.context.scene.frame_set(0)
        bare, clear = mesh_test.clearance(pose['gun'])
        numbers = review.metrics([pose], meta, scn['carry'])
        lines.append(f'{label} rifle-hold-low + {name}: gripCm {numbers["gripCm"]}, elbowDeg {numbers["elbowDeg"]}, '
                     f'wristDeg {numbers["wristDeg"]}, gunHits {bare or 0}, gunClearCm {clear}')
        print(lines[-1])
    return lines


def patch_clips(src_glb, src_json):
    """Copies each animation of src_glb over the one of the same name in OUT_GLB, channel by channel
    (same node, path and sample count), and its notes into OUT_JSON."""
    gltf, binary = gltfio.read(OUT_GLB)
    src, src_bin = gltfio.read(src_glb)
    binary = bytearray(binary)
    names = [n.get('name') for n in gltf['nodes']]
    src_names = [n.get('name') for n in src['nodes']]
    by_name = {a['name']: a for a in gltf['animations']}
    for anim in src['animations']:
        dst = by_name[anim['name']]
        where = {(names[c['target']['node']], c['target']['path']): dst['samplers'][c['sampler']]['output'] for c in dst['channels']}
        for ch in anim['channels']:
            key = (src_names[ch['target']['node']], ch['target']['path'])
            a_src = src['accessors'][anim['samplers'][ch['sampler']]['output']]
            a_dst = gltf['accessors'][where[key]]
            if (a_src['count'], a_src['type'], a_src['componentType']) != (a_dst['count'], a_dst['type'], a_dst['componentType']):
                raise ValueError(f'{anim["name"]} {key}: the clip changed shape; run the full build')
            size = a_src['count'] * {'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[a_src['type']] * 4
            vs, vd = src['bufferViews'][a_src['bufferView']], gltf['bufferViews'][a_dst['bufferView']]
            o_src = vs.get('byteOffset', 0) + a_src.get('byteOffset', 0)
            o_dst = vd.get('byteOffset', 0) + a_dst.get('byteOffset', 0)
            binary[o_dst:o_dst + size] = src_bin[o_src:o_src + size]
    gltfio.write(OUT_GLB, gltf, bytes(binary))
    notes = json.loads(OUT_JSON.read_text())
    notes['clips'].update(json.loads(src_json.read_text())['clips'])
    OUT_JSON.write_text(json.dumps(notes, indent=1))
    print('patched', [a['name'] for a in src['animations']])


def append_clips(src_glb, src_json):
    """Adds each animation of src_glb to OUT_GLB (replacing one of the same name: its old data is
    left unused in the buffer until the next full build), and its notes to OUT_JSON. For new clips
    while iterating; a full build gives the same clips."""
    gltf, binary = gltfio.read(OUT_GLB)
    src, src_bin = gltfio.read(src_glb)
    binary = bytearray(binary)
    index = {n.get('name'): i for i, n in enumerate(gltf['nodes'])}
    src_names = [n.get('name') for n in src['nodes']]
    names = {a['name'] for a in src['animations']}
    gltf['animations'] = [a for a in gltf['animations'] if a['name'] not in names]
    for anim in src['animations']:
        samplers = []
        for smp in anim['samplers']:
            new = {}
            for key in ('input', 'output'):
                acc = dict(src['accessors'][smp[key]])
                view = dict(src['bufferViews'][acc['bufferView']])
                while len(binary) % 4:
                    binary.append(0)
                start = view.get('byteOffset', 0)
                chunk = src_bin[start:start + view['byteLength']]
                view['byteOffset'] = len(binary)
                view['buffer'] = 0
                binary += chunk
                gltf['bufferViews'].append(view)
                acc['bufferView'] = len(gltf['bufferViews']) - 1
                gltf['accessors'].append(acc)
                new[key] = len(gltf['accessors']) - 1
            new['interpolation'] = smp.get('interpolation', 'LINEAR')
            samplers.append(new)
        channels = [{'sampler': c['sampler'], 'target': {'node': index[src_names[c['target']['node']]], 'path': c['target']['path']}} for c in anim['channels']]
        gltf['animations'].append({'name': anim['name'], 'samplers': samplers, 'channels': channels})
    gltf['buffers'][0]['byteLength'] = len(binary)
    gltfio.write(OUT_GLB, gltf, bytes(binary))
    notes = json.loads(OUT_JSON.read_text())
    notes['clips'].update(json.loads(src_json.read_text())['clips'])
    OUT_JSON.write_text(json.dumps(notes, indent=1))
    print('appended', [a['name'] for a in src['animations']])


def main(only=None, patch=False):
    skeleton = skel.Skeleton(BODY, FRAMES)
    fingers = {n: q for n, q in skel.grip().items() if n in skeleton.joints}
    REVIEW.mkdir(parents=True, exist_ok=True)
    report = []
    # the idle's mean hip height, against which every clip's is given
    idle_hips = None

    done = []
    shotgun_lines = []
    if not only or any(n in HANDLING['shotgun'] for n in only):
        scn, author, mesh_test, sheets = scene_for('shotgun', skeleton, fingers)
        bpy.app.driver_namespace['rifle_motion_shotgun'] = dict(scn=scn, author=author, mesh_test=mesh_test, skeleton=skeleton, make=make, judge=judge)
        for name in ([] if only else SHOTGUN):
            baked, meta, numbers = judge(scn, author, mesh_test, sheets, name, idle_hips, prefix='shotgun-')
            if name == 'rifle-idle':
                idle_hips = sum(f['hips'].y for f in baked) / len(baked)
            shotgun_lines.append(f'shotgun {name}: ' + ', '.join(f'{k} {v}' for k, v in numbers.items()))
            print(shotgun_lines[-1])
        if not only:
            shotgun_lines += fidget_check(scn, author, mesh_test, 'shotgun')
        for name in HANDLING['shotgun']:
            if only and name not in only:
                continue
            baked, meta, numbers = judge(scn, author, mesh_test, sheets, name, idle_hips)
            meta['review'] = numbers
            shotgun_lines.append(f'{name}: ' + ', '.join(f'{k} {v}' for k, v in numbers.items()))
            print(shotgun_lines[-1])
            done.append((name, baked, meta))

    scn, author, mesh_test, sheets = scene_for('rifle', skeleton, fingers)
    # (kept for fitting scripts run after a build: bpy.app.driver_namespace['rifle_motion'])
    bpy.app.driver_namespace['rifle_motion'] = dict(scn=scn, author=author, mesh_test=mesh_test, skeleton=skeleton, make=make, judge=judge)
    for name in CLIPS + HANDLING['rifle']:
        if only and name not in only:
            continue
        baked, meta, numbers = judge(scn, author, mesh_test, sheets, name, idle_hips)
        if name == 'rifle-idle':
            idle_hips = sum(f['hips'].y for f in baked) / len(baked)
        meta['review'] = numbers
        report.append(f'{name}: ' + ', '.join(f'{k} {v}' for k, v in numbers.items()))
        print(report[-1])
        done.append((name, baked, meta))
    if not only:
        report += fidget_check(scn, author, mesh_test, 'rifle')
    report += shotgun_lines
    (REVIEW / ('clips.txt' if not only else 'clips-partial.txt')).write_text('\n'.join(report) + '\n')

    if only and patch == 'export':
        # just these clips, into OUT_GLB / OUT_JSON as a pack of their own (checks, comparisons)
        bake.export(BODY, skeleton, done, OUT_GLB, OUT_JSON, {'clips': {n: {k: v for k, v in m.items() if k not in ('review', 'shift')} for n, _, m in done}}, VERSION)
        return report

    if only and patch == 'append':
        tmp_glb, tmp_json = OUT_GLB.with_suffix('.patch.glb'), OUT_JSON.with_suffix('.patch.json')
        bake.export(BODY, skeleton, done, tmp_glb, tmp_json, {'clips': {n: {k: v for k, v in m.items() if k not in ('review', 'shift')} for n, _, m in done}})
        append_clips(tmp_glb, tmp_json)
        tmp_glb.unlink()
        tmp_json.unlink()
        return report

    if only and patch:
        # Re-exports just these clips into the existing GLB and JSON in place (patch_clips): the clips
        # must already be in it with the same channels and frame counts. A full build gives the same.
        tmp_glb, tmp_json = OUT_GLB.with_suffix('.patch.glb'), OUT_JSON.with_suffix('.patch.json')
        bake.export(BODY, skeleton, done, tmp_glb, tmp_json, {'clips': {n: {k: v for k, v in m.items() if k not in ('review', 'shift')} for n, _, m in done}})
        patch_clips(tmp_glb, tmp_json)
        tmp_glb.unlink()
        tmp_json.unlink()
        return report

    if not only:
        notes = {
            'version': VERSION,
            'skeleton': 'earthonline-ue5-v1',
            'body': BODY.name,
            'fps': 30,
            'generator': 'blender/build_rifle_motion.py',
            'note': 'In place (no hips travel). speed: m/s of ground under a planted foot; dir: (x, z) of travel in the '
                    "model's frame (+x left, +z forward); cycles: gait cycles (two steps each) in the clip; contact: each "
                    "foot's stances as [start, end] shares of the whole clip (end < start wraps); leftStrike: when the left "
                    'foot lands. Gun: the gun\'s butt (translation) and turn (rotation) in the spine_05 bone\'s frame (identity rest: the old Spine2 joint\'s), the '
                    "gun's own frame being the glTF one (barrel along -z); rifle-hold-low / -high are the two holds, one "
                    'frame each, with the pelvis square.',
            'bones': body.T.get('bonesNote') or 'Every clip keys the rotation of all 90 bones as real glTF local rotations (rest included: a bone at rest '
                     'holds its node rotation, not the identity), and the translation of root, pelvis, ik_foot_l, ik_foot_r, '
                     'ik_hand_gun, ik_hand_l, ik_hand_r. Exact mapping from the old skeleton: spine_02 / spine_04 / neck_02 '
                     'and the metacarpals at rest, eyes and jaw at rest (the game drives them). Twist bones keyed: '
                     'lowerarm_twist_02 / _01 = 0.47 / 0.88 of the hand\'s twist about the forearm, calf_twist_02 / _01 = '
                     '0.24 / 0.44 of the foot\'s about the shin, upperarm_twist_01 / _02 = -0.50 / -0.25 and thigh_twist_01 / '
                     '_02 = -0.30 / -0.15 of the bone\'s own twist (swing-twist about +Y, unwrapped frame to frame). IK bones: '
                     'ik_foot_l/r = the feet\'s transforms in the root\'s space (ik_foot_root at rest), ik_hand_gun = '
                     'hand_r (ik_hand_root at rest), ik_hand_l = hand_l in ik_hand_gun\'s frame, ik_hand_r = identity '
                     '(ik_hand_gun\'s twin).',
            'rootMotion': 'A clip whose notes carry `root` (per frame [x, z, yaw]: the transitions) keys the same track on '
                          'the root bone: translation (x, 0, z) and rotation yaw about +Y, so root world = T(x, 0, z) * '
                          'Ry(yaw) and everything else is relative to it (the pelvis translation is in the root\'s frame, '
                          'as before). Every other clip keys root at rest (origin, identity): in place. A player that '
                          'moves the character by notes `root` (as the game does) must hold the root bone at rest; one '
                          'that plays the root bone (Unreal root motion) must not move the character too.',
            'gun': {'node': bake.GUN, 'parent': 'spine_05', 'holds': {k: dict(at=[round(x, 4) for x in v['at']], yaw=v['yaw'], pitch=v['pitch'], roll=v['roll'])
                                                                   for k, v in carry.HOLDS.items()},
                    # slung across the back: the butt and turn (x, y, z, w) in the chest joint's frame
                    'stow': {g: dict(at=[round(x, 4) for x in carry.STOW[g]['at']],
                                     quat=[round(x, 6) for x in (lambda q: (q.x, q.y, q.z, q.w))(carry.basis_quat(carry.STOW[g]['muzzle'], carry.STOW[g]['top']))])
                             for g in carry.STOW}},
            'handling': 'Handling clips (swap-*, reload-*, shotgun-pump, *-aim-*) are upper-body actions over rifle-hold-low: '
                        'their spine, neck, head and collarbones are played as a difference from that hold. Extra nodes under '
                        'spine_05: GunIn (the gun coming off the back in a swap), PalmL / PalmR (palm middle and the hand\'s CANONICAL turn: the real hand_l / hand_r world '
                        'rotation is it times the hand\'s rest world rotation), '
                        'ElbowL / ElbowR (elbow). A gun track is its butt less that gun\'s carry shift. events: seconds; '
                        'track: per frame, hold [left, right] (0 nothing, 1 Gun, 2 GunIn), curl [left, right] 0..1, and the '
                        'loose parts where a clip moves them.',
            # the belt kit (rifle_motion/pouch.py), in the pelvis bone's frame: the game builds it on the bone
            'pouch': pouch.notes(),
            'pouchParent': 'pelvis',
            'clips': {name: {k: v for k, v in meta.items() if k not in ('review', 'shift')} for name, _, meta in done},
        }
        result = bake.export(BODY, skeleton, done, OUT_GLB, OUT_JSON, notes, VERSION)
        twist = result.pop('twist')
        print('exported', OUT_GLB.name, result)
        lines = []
        for clip, bones in twist.items():
            worst = max(bones.items(), key=lambda kv: kv[1][0])
            lines.append(f'{clip}: worst step {worst[1][0]:.2f} deg ({worst[0]}); ' + ', '.join(
                f'{b} {v[0]:.2f} [{v[1]:+.0f}..{v[2]:+.0f}]' for b, v in bones.items()))
        (REVIEW / 'twist.txt').write_text('Twist bones per clip: largest frame-to-frame change (deg) [range of the angle, deg]\n' + '\n'.join(lines) + '\n')
        # Round trip: the exported file, posed by plain forward kinematics, against the skeleton
        # Blender posed (every joint, every frame).
        gltf, binary = gltfio.read(OUT_GLB)
        names = [n.get('name') for n in gltf['nodes']]
        worst = 0.0
        for anim in gltf['animations']:
            frames = next(b for n, b, _ in done if n == anim['name'])
            tracks = {}
            for ch in anim['channels']:
                tracks[names[ch['target']['node']], ch['target']['path']] = gltfio.rows(gltf, binary, anim['samplers'][ch['sampler']]['output'])
            root = next(m for n, _, m in done if n == anim['name']).get('root')
            for i, frame in enumerate(frames):
                W, P = {}, {}
                for j in skeleton.order:  # plain glTF FK of the file
                    q = skel.gl_quat(tracks[j, 'rotation'][i]).normalized()
                    t = Vector(tracks[j, 'translation'][i]) if (j, 'translation') in tracks else skeleton.rest_t[j]
                    p = skeleton.parent[j]
                    W[j], P[j] = (q, t) if p is None else (W[p] @ q, P[p] + W[p] @ t)
                rq, rt = (skel.Quaternion((0, 1, 0), root[i][2]), Vector((root[i][0], 0, root[i][1]))) if root else (skel.Quaternion(), Vector())
                worst = max(worst, max((P[j] - (rq @ frame['pos'][j] + rt)).length for j in skeleton.authored))
        print(f'round trip: exported file against Blender\'s skeleton, worst joint {worst * 1000:.3f} mm')
        walk = next(d for d in done if d[0] == 'rifle-walk-f')
        sample = walk[1][0]['pos']  # frame 0: for the check in the game
        (REVIEW / 'roundtrip.json').write_text(json.dumps({'clip': walk[0], 'frame': 0, 'worstMm': round(worst * 1000, 4),
                                                           'joints': {j: [round(x, 5) for x in sample[j]] for j in skeleton.authored}}, indent=1))
        bpy.context.scene.frame_set(0)
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    return report


main(globals().get('ONLY'), globals().get('PATCH', False))
