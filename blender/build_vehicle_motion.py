"""Builds public/characters/vehicle-motion-<body>-v1.glb and .json: the character's vehicle clips (getting
into, sitting in, operating and getting out of the supercar and the helicopter), pass A1.

Same machinery as the rifle pack (build_rifle_motion.py), reused and not changed: the skeleton in
canonical frames (rifle_motion/skel.py), the control rig (rig.py; the guns it builds are hidden, the
slung rifle's place is written as the Gun track), keys (keys.py), the bake to 30 fps with the twist
and IK bones (bake.py), the export (bake.export), the review's numbers (review.py) and close-ups
(closeups.py). New here (blender/vehicle_motion/):

  vehicles.py   the vehicles' node frames from their GLBs (read-only), the moving nodes as functions
                of the controls (door, wheel, cyclic, collective, pedals), the vehicle as a prop
  pose.py       clips authored in the vehicle's frame; the character's root carried per frame
  clips_car.py, clips_heli.py   the clips
  judge.py      the body against the vehicle, head clearance, contact distances, snap, sheets

Run it in this project's Blender (port 9877):

  python3 blender/tools/bl.py run blender/build_vehicle_motion.py

Globals a run may set first (each bl.py call is a fresh namespace):
  BODY_NAME = 'tripo' (default) or 'player' (the EarthOnline bodies' pack, built on civilian-m-01)
  ONLY = ['car-drive', ...]   just these clips (judged, not exported unless EXPORT = True)
  NO_SHEETS = True            numbers only
  OUT_GLB = path              where the pack goes (default public/characters/<VERSION>.glb)
"""
import importlib
import json
import math
import pathlib
import sys
import time

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from rifle_motion import body  # noqa: E402

BODIES = {
    'player': dict(BODY=ROOT / 'public/characters/civilian-m-01-player-ue5.glb', FRAMES=None, TABLE='civilian-m-01-player-ue5',
                   VERSION='vehicle-motion-ue5-v1', REVIEW_DIR=HERE / 'review/vehicles/ue5', BLEND=HERE / 'vehicle_motion_ue5.blend'),
    'tripo': dict(BODY=HERE / 'bodies/tripo/tripo-player-ue5.glb', FRAMES=HERE / 'bodies/tripo/tripo_frames.json', TABLE='tripo-player-ue5',
                  VERSION='vehicle-motion-tripo-v1', REVIEW_DIR=HERE / 'review/vehicles/tripo', BLEND=HERE / 'vehicle_motion_tripo.blend'),
}
_CHOICE = dict(BODIES[globals().get('BODY_NAME', 'tripo')])
importlib.reload(body)
body.select(_CHOICE['TABLE'])
from rifle_motion import bake, carry, closeups, crouch, gait, gltfio, handling, keys, pouch, reactions, review, rig, skel, transitions  # noqa: E402

for module in (gltfio, skel, carry, pouch, rig, gait, crouch, transitions, handling, reactions, keys, bake, review, closeups):
    importlib.reload(module)
from vehicle_motion import vehicles, pose, judge, judge_a2, judge_a4, clips_car, clips_heli, clips_a4, fit  # noqa: E402

for module in (fit, vehicles, pose, judge, judge_a2, judge_a4, clips_car, clips_heli, clips_a4):
    importlib.reload(module)
FIT = fit.FITS[_CHOICE['TABLE']]
vehicles.FIT.clear()
vehicles.FIT.update(FIT)

BODY, FRAMES, VERSION, BLEND = _CHOICE['BODY'], _CHOICE['FRAMES'], _CHOICE['VERSION'], _CHOICE['BLEND']
OUT_GLB = pathlib.Path(globals().get('OUT_GLB', ROOT / f'public/characters/{VERSION}.glb'))
OUT_JSON = OUT_GLB.with_suffix('.json')
REVIEW = pathlib.Path(globals().get('REVIEW_DIR', _CHOICE['REVIEW_DIR']))

CAR = ['car-drive', 'car-steer-l', 'car-steer-r', 'car-look-back', 'car-enter', 'car-exit']
HELI = ['heli-fly', 'heli-cyclic-f', 'heli-cyclic-b', 'heli-cyclic-l', 'heli-cyclic-r', 'heli-collective-up', 'heli-collective-down',
        'heli-pedal-l', 'heli-pedal-r', 'heli-enter', 'heli-exit']
# Shipped (pass A1 follow-up): the car's and the helicopter's seated clips, with the vehicle fit (fit.py).
# car-enter is authored (clips_car.enter) and judged but not shipped (it fails the body-against-car test);
# car-exit, heli-enter and heli-exit are not authored.
SHIPPED = ['car-drive', 'car-steer-l', 'car-steer-r', 'car-look-back', 'heli-fly', 'heli-cyclic-f', 'heli-cyclic-b', 'heli-cyclic-l',
           'heli-cyclic-r', 'heli-collective-up', 'heli-collective-down', 'heli-pedal-l', 'heli-pedal-r']
CLIPS = globals().get('CLIPS') or SHIPPED
# close-ups at the hard moments: clip -> [(frame or a named moment, views)]
HANDS_VIEWS = ('grip-right', 'grip-left', 'support-right', 'support-left')
CLOSEUPS = {
    'car-drive': [(0, HANDS_VIEWS + ('cheek-side',))],
    'car-steer-l': [(0, HANDS_VIEWS + ('front',))],
    'car-steer-r': [(0, HANDS_VIEWS + ('front',))],
    'car-look-back': [(0, ('grip-right', 'support-left', 'cheek-front', 'back'))],
    # (pass A2: the hand on the handle, the door at its widest with the body beside it, the lowest point of the sit, each leg
    # crossing the sill, the knees under the rim, the hand pulling the door shut, the end)
    'car-enter': [('handle', ('grip-right', 'right', 'front')), (75, ('right', 'front', 'back')), (141, ('cheek-side', 'right', 'front')),
                  (158, ('right', 'front', 'below')), (172, ('right', 'front', 'below')), (180, ('front', 'below', 'right')),
                  (198, ('grip-left', 'support-left', 'right')), ('end', HANDS_VIEWS)],
    # (pass A2: the hand pushing the door open from inside, each leg crossing the sill, the knee coming out from under the
    # rim, the hand on the sill as the hips rise, the head through the doorway, the hand pulling the door shut, the end)
    # (pass A2 follow-up 2: the hand on the outside handle, the foot on the skid and the hand on the post, the right leg into
    # the footwell, the left hand on the seat, the hips on the seat edge, the left leg over the cyclic, the hand pulling the
    # door shut, the end on the collective at its bottom stop)
    'heli-enter': [(40, ('grip-right', 'right', 'front')), (80, ('right', 'front', 'back')), (98, ('right', 'front', 'below')),
                   (112, ('support-left', 'right', 'front')), (138, ('right', 'front', 'below')), (170, ('front', 'below', 'right')),
                   (178, ('front', 'below', 'right')), (198, ('grip-right', 'right', 'front')), ('end', HANDS_VIEWS)],
    'car-exit': [(22, ('support-left', 'right', 'front')), (75, ('right', 'front', 'below')), (98, ('front', 'below', 'right')),
                 (105, ('right', 'front', 'below')), (112, ('support-left', 'right', 'front')), (135, ('cheek-side', 'right', 'front')),
                 (182, ('grip-right', 'right', 'front')), ('end', ('right', 'front', 'back'))],
    'heli-fly': [(0, ('grip-right', 'grip-left', 'support-right', 'support-left', 'below'))],
    'heli-cyclic-f': [(0, ('grip-right', 'grip-left', 'right'))],
    'heli-cyclic-b': [(0, ('grip-right', 'grip-left', 'right'))],
    'heli-cyclic-l': [(0, ('grip-right', 'grip-left', 'front'))],
    'heli-cyclic-r': [(0, ('grip-right', 'grip-left', 'front'))],
    'heli-collective-up': [(0, ('support-right', 'support-left'))],
    'heli-collective-down': [(0, ('support-right', 'support-left'))],
    'heli-pedal-l': [(0, ('below', 'right'))],
    'heli-pedal-r': [(0, ('below', 'right'))],
    # (pass A2 follow-up 2: heli-enter's path backwards: the hands leaving the controls, the hand pushing the door open, the
    # left leg back over the cyclic, the left hand on the seat, the foot onto the skid, the right leg out of the footwell, the
    # hand pushing the door shut on its outside handle, the end)
    # (pass A3: heli-exit's own move: the hand pushing the door open on its glass, the left leg over the cyclic, facing
    # out on the doorway's step with the left hand on the front post, the foot on the skid, on the ground, the hand
    # pushing the door shut from in front of it, the end)
    'heli-exit': [(30, ('grip-right', 'right', 'front')), (69, ('front', 'below', 'right')), (96, ('support-left', 'right', 'front')),
                  (135, ('right', 'front', 'below')), (159, ('right', 'front', 'back')), (242, ('grip-right', 'right', 'front')),
                  ('end', ('right', 'front', 'back'))],
    'heli-exit-old': [(8, HANDS_VIEWS), (42, ('grip-right', 'right', 'front')), (62, ('front', 'below', 'right')), (70, ('front', 'below', 'right')),
                  (128, ('support-left', 'right', 'front')), (142, ('right', 'front', 'below')), (160, ('right', 'front', 'back')),
                  (200, ('grip-right', 'right', 'front')), ('end', ('right', 'front', 'back'))],
}


def setup():
    skeleton = skel.Skeleton(BODY, FRAMES)
    fingers = {n: q for n, q in skel.grip().items() if n in skeleton.joints}
    scn = rig.build(BODY, 'rifle', skeleton)
    scn['skel'] = skeleton
    # no guns, no belt kit in a vehicle clip: hidden (the rig still carries them, at the sling)
    for o in scn['gun']['meshes'] + scn['gun2']['meshes'] + [scn['shell']] + [o for o in bpy.data.objects if o.name.startswith('kit_')]:
        o.hide_render = o.hide_viewport = True
    author = gait.Author(skeleton, fingers, scn['carry'])
    REVIEW.mkdir(parents=True, exist_ok=True)
    review.Sheets(bpy.context.scene, REVIEW, [scn['rig']] + [o for o in bpy.data.objects if o.name.startswith('Icosphere')])
    props = {}
    for kind in ('car', 'heli'):
        veh = vehicles.Vehicle(kind)
        empty, objs = vehicles.import_prop(kind)
        vehicles.apply_fit(veh, objs)
        # (pass A3: the props read at rest: a re-used prop can still carry an earlier clip's keys (door open), and the
        # judge takes each mesh in its node's frame from where the object stands now)
        vehicles.key_prop(veh, empty, objs, [(0.0, 0.0, 0.0)], [{}])
        bpy.context.scene.frame_set(0)
        bpy.context.view_layer.update()
        test = judge.VehicleTest(veh, objs, scn['body'], empty)
        props[kind] = dict(veh=veh, empty=empty, objs=objs, test=test)
    # (pass A4: the ground clips' 'vehicle' and the body against the ground plane)
    props['ground'] = dict(veh=clips_a4.Ground(), empty=None, objs={}, test=judge_a4.GroundTest(scn['body']))
    ctx = dict(scn=scn, skeleton=skeleton, author=author, props=props)
    bpy.app.driver_namespace['vehicle_motion'] = ctx
    return ctx


def make_clip(name, ctx):
    if name in clips_a4.NAMES:  # (pass A4: the athletic clips)
        kind = {'car-bail': 'car', 'heli-jump': 'heli'}.get(name, 'ground')
        return clips_a4.make(name, ctx['props'][kind]['veh'], ctx['author'])
    kind = 'car' if name.startswith('car-') else 'heli'
    veh = ctx['props'][kind]['veh']
    mod = clips_car if kind == 'car' else clips_heli
    return mod.make(name, veh, ctx['author'])


def show_only(ctx, kind, parts=None):
    """Shows one vehicle (all of it, or only `parts`), hides the other."""
    for k, p in ctx['props'].items():
        for name, o in p['objs'].items():
            if o.type != 'MESH':
                continue
            vis = k == kind and (parts is None or name in parts) and 'blur' not in name
            o.hide_render = not vis


CONTACT_PARTS = {'car': ('seat_driver', 'steering_wheel', 'door_L', 'door_glass_L', 'mirror_L'),
                 'heli': ('pilot_seat', 'cyclic', 'collective', 'pedal_L', 'pedal_R', 'cockpit_door_R', 'cockpit_door_R_glass', 'cockpit_door_R_handle',
                          'skid_R', 'skid_supports', 'instrument_panel')}


SEATED_PARTS = {'car': ('seat_driver', 'steering_wheel'),
                'heli': ('pilot_seat', 'cyclic', 'collective', 'pedal_L', 'pedal_R')}


def contacts_by_frame(meta, n):
    on = [dict() for _ in range(n)]
    for c in meta['contacts']:
        for i in range(c['from'], c['to'] + 1):
            if 0 <= i < n and c['node']:
                on[i][c['part']] = c['node']
    return on


def contact_miss(meta, P, ctls, veh):
    """Per contact: the largest distance (cm) of the palm (hands) / ball (feet) from its point."""
    out = []
    for c in meta['contacts']:
        worst = 0.0
        for i in range(c['from'], min(c['to'], len(P) - 1) + 1):
            if c['node']:
                want = veh.world(c['node'], ctls[i]) @ Vector(c['at'])
            else:
                want = Vector(c['at'])
            part = c['part']
            got = P[i]['hand_' + part[-1]] if part.startswith('hand') else P[i][{'ball': 'sole', 'heel': 'heel'}[c.get('point') or 'ball'] + '_' + part[-1]]
            worst = max(worst, (got - want).length)
        out.append((c['part'], c['from'], c['to'], c['node'], c['kind'], round(worst * 100, 2)))
    return out


def moment(name, meta, P, V):
    """Named frames for the close-ups."""
    n = meta['frames']
    if 'handle' == name:
        return next((c['from'] for c in meta['contacts'] if c['kind'] == 'handle'), 0)
    if name == 'lowest':  # the hips' lowest point while not yet seated / still getting out
        return min(range(n), key=lambda i: P[i]['pelvis'].y + (5.0 if V[i]['ctl'].get('seated') else 0.0))
    if name == 'sill':  # a foot passing over the sill / the skid
        return max(range(n), key=lambda i: min(P[i]['ball_l'].y, P[i]['ball_r'].y) if abs(P[i]['ball_l'].x) > 0.6 or abs(P[i]['ball_r'].x) > 0.6 else -1)
    if name == 'skid':
        return next((c['from'] for c in meta['contacts'] if c['node'] == 'skid_R'), 0)
    if name == 'end':
        return n - 1
    if name.startswith('f'):  # (pass A4: a clip frame, as the gate names it)
        return int(name[1:])
    return int(name)


def key_knees(scn, action, frames):
    """Keys the rig's knee poles (rifle_motion's rig hangs them on the foot controls and keys.py never keys
    them): where a frame gives `knees` (root frame points the knees bend towards) the pole goes there, else
    it stays at its rest on the foot. Every vehicle clip keys them, so none is left over from another."""
    rig_obj = scn['rig']
    bones = rig_obj.data.bones
    values = {}
    for f in frames + frames[:1]:
        for side, s in (('Left', 'L'), ('Right', 'R')):
            t = Vector()
            if f.get('knees'):
                ground, yaw, pitch = f['feet'][side][:3]
                rf = bones['foot_ctrl.' + s].matrix_local
                whole = f['feet'][side][3] if len(f['feet'][side]) > 3 else Quaternion((0, 1, 0), yaw)
                posed = Matrix.Translation(skel.g2b(ground)) @ (skel.rot_b(whole) @ rf.to_quaternion()).to_matrix().to_4x4()
                k = posed @ rf.inverted() @ bones['knee_pole.' + s].matrix_local
                t = k.to_3x3().inverted() @ (skel.g2b(f['knees'][side]) - k.translation)
                w_ = f.get('knees_w', 1.0)
                t = t * (w_[0 if s == 'L' else 1] if isinstance(w_, tuple) else w_)  # (pass A2: blended back to the rest on the foot)
            for i in range(3):
                values.setdefault((f'pose.bones["knee_pole.{s}"].location', i), []).append(t[i])
    keys._write(action, rig_obj, values, len(frames) + 1)


def run_clip(ctx, name, sheets=True):
    t0 = time.time()
    scn, skeleton = ctx['scn'], ctx['skeleton']
    scene = bpy.context.scene
    clip = make_clip(name, ctx)
    kind = clip.veh.kind
    p = ctx['props'][kind]
    if kind != 'ground':
        p['test'].__class__ = judge.VehicleTest  # (a reused scene keeps the instance; the class is this run's)
    frames, meta, V, roots = clip.make(scn['carry'], scn['carry2'])
    action = keys.key_clip(scn, skeleton, name, frames)
    key_knees(scn, action, frames)
    n = meta['frames']
    baked = bake.bake(scene, scn, action, n)
    bake.key_twist(scn, name, bake.gltf_frames(skeleton, baked + baked[:1] if meta['loop'] else baked, meta['root'] + meta['root'][:1] if meta['loop'] else meta['root']))
    ctls = [v['ctl'] for v in V]
    ground = bpy.data.objects['review-ground']
    if kind != 'ground':
        vehicles.key_prop(p['veh'], p['empty'], p['objs'], roots, ctls)
        ground.hide_render = True  # (the vehicle's own ground plane: the review floor would be wrong under a moving root)
    else:  # (pass A4: the ground plane of the clip's frame, carried by the inverse root like a vehicle)
        ground.hide_render = False
        ground.animation_data_clear()
        ground.rotation_mode = 'QUATERNION'
        for f, (x, z, yaw) in enumerate(roots):
            ground.matrix_basis = vehicles.C4 @ (Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y')).inverted() @ vehicles.CI
            ground.keyframe_insert('location', frame=f)
            ground.keyframe_insert('rotation_quaternion', frame=f)
    numbers = review.metrics(baked, meta, scn['carry'])
    numbers.pop('gripCm', None)
    P = judge.world_parts(baked, roots)
    sn = judge.snap(P)
    numbers['snap30'] = ' / '.join(f'{k} {v:.1f}' for k, v in sn.items())
    numbers['snapMax'] = round(max(sn.values()), 2)
    # the body against the vehicle, every frame
    on = contacts_by_frame(meta, n)
    pairs, seat, contact = {}, {}, {}
    per_frame, head = [], []
    sink = {'cushion': 0.0, 'back': 0.0, 'bolster': 0.0}
    gaps, clears = [], []
    results = []
    for i in range(n):
        scene.frame_set(i)
        r = p['test'].frame(roots[i], ctls[i], on[i])
        results.append(r)
        for d, src in ((pairs, r['pairs']), (seat, r['seat']), (contact, r['contact'])):
            for k, v in src.items():
                d[k] = d.get(k, 0) + v
        per_frame.append(sum(r['pairs'].values()))
        head.append((r['headCm'], r['headBy'], r['headTop']))
        for k in sink:
            sink[k] = max(sink[k], r['sinkCm'][k])
        gaps.append(r['backGapCm'])
        clears.append(r['clearCm'])
    worst_head = min(range(n), key=lambda i: head[i][0])
    numbers['vehiclePairs'] = pairs or 0
    numbers['framesWithPairs'] = sum(1 for x in per_frame if x)
    numbers['seatPairs'] = seat or 0
    numbers['contactPairs'] = sum(contact.values())
    numbers['seatSinkCm'] = f"cushion {sink['cushion']:.1f} / back {sink['back']:.1f} / bolster or harness {sink['bolster']:.1f}"
    numbers['backGapCm'] = f'{min(gaps):.1f}..{max(gaps):.1f}'  # back parts' nearest approach to the seat (0 = on it)
    numbers['controlClearCm'] = f'{min(clears):.1f}'  # knees / shins from the rim (car), thighs / shins from the cyclic (heli)
    numbers['headClearCm'] = f'{head[worst_head][0]:.1f} at frame {worst_head} ({head[worst_head][1]}), head top y {max(h[2] for h in head):.3f}'
    misses = contact_miss(meta, P, ctls, p['veh'])
    numbers['contactCm'] = '; '.join(f'{m[0]} {m[3]} {m[1]}-{m[2]} {m[5]}' for m in misses)
    for side in ('Left', 'Right'):  # elbow inside angle (180 - bend), the coordinator's measure
        pass
    numbers['contactMaxCm'] = max((m[5] for m in misses if m[0].startswith('hand')), default=0.0)
    ctx.setdefault('baked', {})[name] = (baked, roots)
    if name in clips_a4.NAMES:  # (pass A4: the athletic gate's measures)
        refs = {}
        for label, (other, k_this, k_other) in clips_a4.JOINS.get(name, {}).items():
            if other == name:
                refs[label] = (k_this if k_this >= 0 else n + k_this, baked[k_other if k_other >= 0 else n + k_other])
                continue
            if other not in ctx['baked']:
                run_clip(ctx, other, sheets=False)
                return run_clip(ctx, name, sheets)
            ob = ctx['baked'][other][0]
            refs[label] = (k_this if k_this >= 0 else n + k_this, ob[k_other if k_other >= 0 else len(ob) + k_other])
        if kind != 'ground':  # (the start on the seated reference, in the vehicle's frame: the clip gate's join)
            ref_name = 'car-drive' if kind == 'car' else 'heli-fly'
            if ref_name not in ctx['baked']:
                run_clip(ctx, ref_name, sheets=False)
                return run_clip(ctx, name, sheets)
            rb, rr = ctx['baked'][ref_name]
            meta['_veh'], meta['_ctl'] = p['veh'], ctls
            m2 = judge_a2.measures(kind, baked, roots, meta, P, results, ((baked[0], roots[0]), (rb[0], rr[0])))
            meta.pop('_veh')
            meta.pop('_ctl')
            numbers.update({k: m2[k] for k in ('hardPairs', 'softPairs', 'hardMaxCm', 'softMaxCm', 'headByCm', 'joinErr')})
            write_frames(REVIEW / f'{name}-frames.txt', name, results, P, meta, ctls, p['veh'], baked)
        a4 = judge_a4.measures(baked, meta, P, results, refs, getattr(clip, 'roll', ()))
        a4['contactCm'] = contact_miss(meta, P, ctls, p['veh'])
        a4['wristEst'] = getattr(clip, 'wrist_est', None)
        a4['events'] = meta['events']
        a4['duration'] = meta['duration']
        (REVIEW / f'{name}-a4.json').write_text(json.dumps(dict(a4, numbers={k: v for k, v in numbers.items() if isinstance(v, (int, float, str))}), indent=1, default=str))
        numbers.update({k: v for k, v in a4.items() if k not in ('lowestCm', 'lowTrunkCm', 'contactCm', 'events', 'wristPerFrame', 'wristEst')})
    if 'enter' in name or 'exit' in name or name.endswith('-seated') or name == 'heli-collective-down' or globals().get('A2_ALL'):  # (pass A2's measures: depths, wrists per frame, balance, the join)
        ref_name = getattr(clip, 'join_ref', None) or ('car-drive' if kind == 'car' else 'heli-fly')
        if ref_name not in ctx['baked']:
            run_clip(ctx, ref_name, sheets=False)  # (the reference first; then this clip again from the start)
            return run_clip(ctx, name, sheets)
        rb, rr = ctx['baked'][ref_name]
        ref = ((baked[-1], roots[-1]) if 'enter' in name else (baked[0], roots[0]), (rb[0], rr[0]))
        meta['_veh'], meta['_ctl'] = p['veh'], ctls
        numbers.update(judge_a2.measures(kind, baked, roots, meta, P, results, ref))
        meta.pop('_veh')
        meta.pop('_ctl')
        write_frames(REVIEW / f'{name}-frames.txt', name, results, P, meta, ctls, p['veh'], baked)
    meta['review'] = numbers
    ctx['last'] = dict(name=name, P=P, baked=baked, roots=roots, V=V, meta=meta)
    line = f'{name}: ' + ', '.join(f'{k} {v}' for k, v in numbers.items())
    print(line)
    if globals().get('CLOSE_ONLY') and name in globals().get('CLOSE_EXTRA', {}):  # (pass A4: just the named close-ups)
        ctx['clip'] = clip
        scene = bpy.context.scene
        parts = CONTACT_PARTS.get(kind)
        for at, views in globals()['CLOSE_EXTRA'][name]:
            f = moment(at, meta, P, V)
            scene.frame_set(f)
            show_only(ctx, kind, None if globals().get('CLOSE_ALL_PARTS') else parts)
            closeups.render(scene, ctx['scn']['skeleton'], REVIEW / f'close-{name}-{at}.png', f, views)
        show_only(ctx, kind, None)
    if sheets and not globals().get('NO_SHEETS'):
        ctx['clip'] = clip
        render_sheets(ctx, name, meta, P, V, roots, kind)
    print(f'  ({time.time() - t0:.0f} s)')
    return baked, meta, numbers, line, per_frame


def write_frames(path, name, results, P, meta, ctls, veh, baked=None):
    """Per frame (pass A2): the hard pairs and the seat pairs with their depths (cm), the head's clearance by
    part, each contact's distance (cm)."""
    lines = [f'{name}: per frame: hard pairs (body/vehicle depth cm), seat pairs over 1 cm, head clearance by part (cm, - inside), contacts (cm)']
    soft = judge_a2.SOFT[veh.kind]
    for i, r in enumerate(results):
        hard = {k: v for k, v in r['depthCm'].items() if k.split('/')[1] not in soft}
        seat = {k: v for k, v in r['depthCm'].items() if k.split('/')[1] in soft and v > 1.0}
        cs = []
        for c in meta['contacts']:
            if c['from'] <= i <= c['to']:
                want = veh.world(c['node'], ctls[i]) @ Vector(c['at']) if c['node'] else Vector(c['at'])
                part = c['part']
                got = P[i]['hand_' + part[-1]] if part.startswith('hand') else P[i]['sole_' + part[-1]]
                cs.append(f"{part}@{c['node']} {(got - want).length * 100:.2f}")
        head = ' '.join(f'{w} {d:.1f}' for w, d in sorted(r.get('headByCm', {}).items()))
        arm = ''
        if baked is not None:
            from rifle_motion.review import arms
            a = arms(baked[i])
            kn = []
            for s_ in ('l', 'r'):
                f_ = baked[i]['pos']
                kn.append(math.degrees((f_['calf_' + s_] - f_['thigh_' + s_]).angle(f_['foot_' + s_] - f_['calf_' + s_])))
            arm = ' arms ' + ' / '.join(f'{sd[0]} elbow {v[0]:.0f} flex {v[2]:+.0f} dev {v[3]:+.0f}' for sd, v in a.items()) + f' knees {kn[0]:.0f} / {kn[1]:.0f}'
        lines.append(f'{i:4d} hard {hard or "-"} seat {seat or "-"} head {head} contacts {", ".join(cs) or "-"}{arm}')
    path.write_text('\n'.join(lines) + '\n')


def render_sheets(ctx, name, meta, P, V, roots, kind):
    scene = bpy.context.scene
    n = meta['frames']
    k = 20 if ('enter' in name or 'exit' in name) else 10  # (pass A2: 20 frames for getting in and out)
    picks = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)}) if not meta['loop'] else sorted({round(i * n / 8) % n for i in range(8)})
    cam = scene.camera
    cam.data.clip_start = 0.1
    # the body's middle over the clip, in the root frame of each frame (B)
    def centre(f):
        x, z, yaw = roots[f]
        m = (Matrix.Translation((x, 0, z)) @ Matrix.Rotation(yaw, 4, 'Y')).inverted()
        c = m @ ((P[f]['pelvis'] + P[f]['head']) / 2)
        return skel.g2b(c)

    def view(direction, scale, parts, cut=None):
        def setup(f):
            show_only(ctx, kind, parts)
            # (directions in the VEHICLE's frame: the camera turns with the root)
            x, z, yaw = roots[f]
            d = Matrix.Rotation(-yaw, 3, 'Y') @ Vector(direction)
            judge.set_cam(cam, centre(f), skel.g2b(d), scale, cut=cut)
        return setup
    parts = CONTACT_PARTS.get(kind) if ('enter' in name or 'exit' in name or name in clips_a4.NAMES) else SEATED_PARTS.get(kind)
    rows = [('front', view((0, 0.05, -1), 2.2, parts)), ('side', view((-1, 0.05, 0) if kind == 'car' else (1, 0.05, 0), 2.2, parts)),
            ('above', view((0.0001, 1, 0), 2.2, parts)),
            ('section', view((-1, 0.0, 0) if kind == 'car' else (1, 0.0, 0), 2.2, None, cut=0.12)), ('threequarter', view((-1, 0.6, -1.1) if kind == 'car' else (1, 0.6, -1.1), 3.2, None))]
    judge.sheet(scene, REVIEW / f'{name}.png', picks, rows)
    for at, views in list(CLOSEUPS.get(name, ())) + list(globals().get('CLOSE_EXTRA', {}).get(name, ())):
        f = moment(at, meta, P, V) if isinstance(at, str) else at
        cl = ctx.get('clip')
        if not isinstance(at, str) and cl is not None and cl.warp:  # (pass A4: close-up frames are authored frames)
            f = min(n - 1, int(round(cl.Winv(at / 30.0) * 30)))
        scene.frame_set(f)
        show_only(ctx, kind, parts)
        closeups.render(scene, ctx['scn']['skeleton'], REVIEW / f'close-{name}-{at}-{f}.png', f, views)
    show_only(ctx, kind, None)
    cam.data.clip_start = 0.1


def notes_top():
    return {
        'version': VERSION,
        'skeleton': 'earthonline-ue5-v1',
        'body': BODY.name,
        'fps': 30,
        'generator': 'blender/build_vehicle_motion.py',
        'bones': body.T.get('bonesNote') or 'As rifle-motion-ue5-v1: every clip keys the rotation of all 90 bones (real glTF locals) and the translation of root, pelvis and the IK bones; twist bones keyed with their shares.',
        'clipSpace': 'Each clip is authored in its vehicle root\'s own glTF frame (vehicle_root / helicopter_root: +Y up, forward -Z, right +X, metres). '
                     'notes `root` per frame [x, z, yaw]: where the character stands or sits on that frame\'s ground plane: root world (in the vehicle) = '
                     'T(x, 0, z) * Ry(yaw); the character faces (sin yaw, 0, cos yaw), so yaw = pi faces the vehicle\'s forward. The root BONE keys the same '
                     'track (rifle packs\' rule: a player that places the character by notes `root` holds the root bone at rest). Height comes from the pelvis.',
        'seatedReference': 'car-drive frame 0 and heli-fly frame 0 are the seated reference poses (each loop\'s life is added on top and is exactly zero '
                           'at frame 0). The one-pose clips (car-steer-l/-r, car-look-back, heli-cyclic-*, heli-collective-*, heli-pedal-*) are whole-body poses '
                           'built on that reference with only the control (and what follows it) changed: blend them ADDITIVELY over the loop, per bone '
                           'delta = pose * reference^-1 (rotation; translation difference for pelvis), weighted by the control\'s share of its extreme '
                           '(e.g. wheel angle / 90 deg), so the loop keeps the body alive; between two opposite extremes use one at a time by sign. '
                           'Hands and feet: pin them with IK to the clip\'s `contacts` on the live node every frame, which makes the blend exact at the hands.',
        'controls': {
            'car': {'door': 'door_L: local rotation = rest * Rx(-55 deg * door), door 0 shut .. 1 open (the GLB\'s doors_open)',
                    'wheel': 'steering_wheel: local rotation = rest * Ry(wheel deg), glTF local +Y = the column towards the driver (the spec\'s Blender "local Z"); + = turned left. car-steer-l = +90, car-steer-r = -90; car-drive moves it +-3.7 deg (notes `wheel` per frame)'},
            'heli': {'door': 'cockpit_door_R: local rotation = rest * Ry(+68 deg * door)',
                     'cyclic': f'cyclic: local rotation = rest * Rx(-fwd) * Rz(-right) about its floor pivot; heli-cyclic-f/-b fwd = +{vehicles.CYCLIC_DEG["fwd"]} / -{vehicles.CYCLIC_DEG["back"]} deg, -l/-r right = -/+{vehicles.CYCLIC_DEG["side"]} deg',
                     'collective': f'collective: local rotation = rest * Rx(coll) (+ raises the grip); heli-collective-down / -up coll = {vehicles.COLLECTIVE_DEG["down"]} / +{vehicles.COLLECTIVE_DEG["up"]} deg, heli-fly holds {vehicles.COLLECTIVE_DEG["fly"]}',
                     'pedals': f'pedal_L / pedal_R: translated along the parent\'s -Z by +-push; heli-pedal-l pushes the left pedal {vehicles.PEDAL_M} m forward and the right one back by the same, -r the reverse'},
            'note': 'Per clip, notes `ctl` holds the controls per frame (only those that move). The game\'s own control ranges may differ: scale the pose clips\' weights to them; the contacts follow the nodes either way.'},
        'events': 'seconds from the clip\'s start: doorOpenStart, doorOpenEnd, seated, doorCloseStart, doorCloseEnd, handsOn (exit clips: doorOpenStart / -End, unseated (the hips leave the seat), doorCloseStart / -End, handsOff). '
                  'Pass A4: handsOn (enter clips) = the hands on the wheel / the controls, driving or flying input live from here; free (exit clips) = standing clear of the door, movement input may take over from here (the door, if not shut, closes by itself). '
                  'The fast entry / exit clips (A4) are the same moves as before at a speed-limited pace (holds shortened, the moves as brisk as the limits allow); car-exit and heli-exit end standing where the body got out (no steps back to the entry point), '
                  'and their doors close by themselves after free (no hand).',
        'door': 'per frame 0 shut .. 1 open: the game drives the real door node from it (see controls).',
        'contacts': 'list of {part: hand_l | hand_r | foot_l | foot_r, from, to (frames, inclusive), node (vehicle node name, or null = the ground / the vehicle root\'s frame), '
                    'at: [x, y, z] in that node\'s own glTF frame (the palm\'s middle for a hand, the ball of the foot (point: ball) or the back of the heel (point: heel) for a foot), kind}. '
                    'Pin the part to that point with IK while the node moves (the door handle rises with the door, the rim turns with the wheel, the grips move with the sticks). '
                    'kinds: grip (closed hand round a rim / stick / handle), handle, push (flat hand), rest (hand or foot resting on a surface), press (foot on a pedal), step (foot taking weight), ground.',
        'gun': 'Gun keys the rifle\'s sling place (rifle-motion\'s stow, chest frame) in every clip: no gun in the hands. The game puts the held gun on the back with the '
               'outgoing half of the swap clip before car-enter / heli-enter and hides both guns once the door is shut (VEHICLE_NOTES.md).',
        'gunNode': {'node': bake.GUN, 'parent': 'spine_05'},
        'vehicleFit': {k: {n: dict({'translate': v['translate']}, **({'scale': v['scale']} if 'scale' in v else {}), why=v['why']) for n, v in nodes.items()} for k, nodes in FIT.items()},
        'athleticClips': 'Pass A4. car-bail (car frame) and heli-jump (helicopter frame) are like the entry / exit clips (the vehicle root\'s frame, root [x, z, yaw] on its ground plane, door per frame, '
                         'contacts) and start exactly on car-drive frame 0 / heli-fly frame 0; events.release is the frame the body is clear of the vehicle: from there the game carries the body in world space '
                         'with the vehicle\'s velocity. Their last frame is airborne (pelvis 0.90 m over the car\'s ground plane / 1.27 m over the helicopter\'s), root yaw = the body\'s facing. '
                         'bail-roll, fall, land-roll, land-hard are ground clips: the clip\'s own frame, ground y = 0, the travel along -Z, root [x, z, yaw] from where the body starts. bail-roll frame 0 = car-bail\'s '
                         'last frame re-rooted (same pose about the root, root (0, 0, car-bail\'s last root yaw)): its frame is the car\'s at the release, moved to the body (-Z = the car\'s forward, the travel at speed); '
                         'its pelvis starts 0.90 m over its ground, the right shoulder meets it at events.ground; scale the root\'s x / z travel to the speed. fall is a loop with its root fixed at (0, 0, pi), the '
                         'pelvis 1.10 m over the root, facing the root\'s yaw; car-bail\'s and heli-jump\'s last poses are near its frame 0 (one arm lower at their ends, by about 0.3 m: a 0.2 s blend). '
                         'land-roll / land-hard start exactly on fall frame 0 (pelvis 1.10 m over their ground, the soles 0.14 m over it), the feet down at events.ground; free = standing, movement may take over.',
        'parachuteClips': 'Pass A4. Ground-frame clips like the athletic ones (forward -Z, ground y = 0, root [x, z, yaw]). The toggles are at the palms (the hands\' '
                          'palm points, every frame), the risers meet the harness at clavicle_l / clavicle_r. para-hang: a 2 s loop, root fixed at (0, 0, pi), the pelvis 1.10 m over '
                          'the root (as fall), hands up at the toggles. para-steer-l / -r / para-flare: one-pose clips equal to para-hang frame 0 except the pulled arm(s) (left / right / '
                          'both hands down at the hips): add them over para-hang per bone (delta = pose * para-hang frame 0 ^-1) weighted by how far the toggle is pulled. '
                          'para-deploy: from fall frame 0 exactly to para-hang frame 0 (1.4 mm at a hand); events.pull = the handle out of its pocket at the right hip, events.open = '
                          'the opening jerk. para-land: from para-hang frame 0 exactly; the flare (hands to the hips), feet first at events.ground, three steps, standing at events.free, '
                          '2.0 m along -Z. para-pickup: standing to standing (pelvis 0.895 m, hands by the thighs), the pack on a crate 0.45 m ahead, its top 0.55 m up; '
                          'events.grab = both hands on it; from grab to events.onBack the pack goes with the right palm, after it on spine_05; arms stay in front of / above the '
                          'shoulders (clear of a 12 cm pack on the back), the right hand over the right shoulder in the swing.',
        'vehicleFitNote': 'Fixed adjustments of the vehicle for this body family (a driver / pilot setting the seat, the wheel, the pedals): '
                          'translate = an offset in the node\'s PARENT frame (here the vehicle root), added to its rest translation; '
                          'the clips (root, contacts, poses) are authored with them applied: the game must apply the same offsets to the real model '
                          '(a helper point moves with its seat).',
    }


def export(done, out_glb, out_json):
    clips = {}
    for name, _, meta in done:
        m = {k: v for k, v in meta.items() if k not in ('shift', 'review')}
        m['review'] = {k: (v if isinstance(v, (int, float, str)) else json.loads(json.dumps(v, default=str))) for k, v in meta['review'].items()}
        clips[name] = m
    notes = notes_top()
    notes['clips'] = clips
    result = bake.export(BODY, skeleton_of(), done, out_glb, out_json, notes, VERSION)
    # (bake.export names the rifle build as the generator: put this one's name in)
    gltf, binary = gltfio.read(out_glb)
    gltf['asset']['generator'] = f'{VERSION} via blender/build_vehicle_motion.py (Blender {bpy.app.version_string})'
    gltfio.write(out_glb, gltf, binary)
    return result


def skeleton_of():
    return bpy.app.driver_namespace['vehicle_motion']['skeleton']


def roundtrip(done, out_glb):
    sk = skeleton_of()
    gltf, binary = gltfio.read(out_glb)
    names = [nd.get('name') for nd in gltf['nodes']]
    worst = 0.0
    for anim in gltf['animations']:
        frames = next(b for nm, b, _ in done if nm == anim['name'])
        tracks = {}
        for ch in anim['channels']:
            tracks[names[ch['target']['node']], ch['target']['path']] = gltfio.rows(gltf, binary, anim['samplers'][ch['sampler']]['output'])
        root = next(m for nm, _, m in done if nm == anim['name']).get('root')
        for i, frame in enumerate(frames):
            W, Pp = {}, {}
            for j in sk.order:
                q = skel.gl_quat(tracks[j, 'rotation'][i]).normalized()
                t = Vector(tracks[j, 'translation'][i]) if (j, 'translation') in tracks else sk.rest_t[j]
                par = sk.parent[j]
                W[j], Pp[j] = (q, t) if par is None else (W[par] @ q, Pp[par] + W[par] @ t)
            rq, rt = (Quaternion((0, 1, 0), root[i][2]), Vector((root[i][0], 0, root[i][1])))
            worst = max(worst, max((Pp[j] - (rq @ frame['pos'][j] + rt)).length for j in sk.authored))
    return worst


def main():
    only = globals().get('ONLY')
    ctx = bpy.app.driver_namespace.get('vehicle_motion') if globals().get('REUSE') else None
    if ctx is None or ctx.get('body') != str(BODY):
        ctx = setup()
        ctx['body'] = str(BODY)
    done, lines = [], []
    for name in CLIPS:
        if only and name not in only:
            continue
        try:
            baked, meta, numbers, line, _ = run_clip(ctx, name)
        except NotImplementedError as e:
            print(f'{name}: not built ({e})')
            continue
        done.append((name, baked, meta))
        lines.append(line)
    (REVIEW / ('clips.txt' if not only else 'clips-partial.txt')).write_text('\n'.join(lines) + '\n')
    if only and not globals().get('EXPORT'):
        return
    out_glb = OUT_GLB
    result = export(done, out_glb, out_glb.with_suffix('.json'))
    twist = result.pop('twist')
    tl = []
    for clip, bones in twist.items():
        worst = max(bones.items(), key=lambda kv: kv[1][0])
        tl.append(f'{clip}: worst step {worst[1][0]:.2f} deg ({worst[0]}); ' + ', '.join(f'{b} {v[0]:.2f} [{v[1]:+.0f}..{v[2]:+.0f}]' for b, v in bones.items()))
    (REVIEW / ('twist.txt' if not only else 'twist-partial.txt')).write_text('Twist bones per clip: largest frame-to-frame change (deg) [range, deg]\n' + '\n'.join(tl) + '\n')
    rt = roundtrip(done, out_glb)
    print('exported', out_glb, result, f'round trip worst joint {rt * 1000:.3f} mm')
    (REVIEW / 'export.txt').write_text(f'{out_glb.name}: {result}; round trip (file FK vs Blender, every joint, every frame, root applied) worst {rt * 1000:.4f} mm\n')
    # (pass A3 round 2: the game's 60 Hz speed measure on the exported file, entry and exit clips; gate_a2.py reads it)
    sys.path.insert(0, str(ROOT / 'blender'))
    from vehicle_motion import speeds60
    ee = [nm for nm, _, _ in done if 'enter' in nm or 'exit' in nm or nm in clips_a4.NAMES]
    exempt = {nm: [(m['events']['ground'], m['events']['ground'] + 2.0 / 30.0)] for nm, _, m in done if 'ground' in m.get('events', {})}
    if ee:
        sl, _ = speeds60.lines(str(out_glb), ee, exempt=exempt)
        (REVIEW / ('speeds60.txt' if not only else 'speeds60-partial.txt')).write_text('\n'.join(sl) + '\n')
        print('\n'.join(sl))
    if not only:
        bpy.context.scene.frame_set(0)
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))


main()
