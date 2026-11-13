"""Pass U1: the per-clip vehicle data of the vehicle clip packs, in forms Unreal imports (plain python3 + numpy).

  python3 blender/export_unreal/vehicle_data.py      (make.py runs it)

Writes unreal/animations/<pack>/data/ for each config.VEHICLE_PACKS key:
  curves_<clip>.csv   Unreal CurveTable CSV (row = curve, columns = key times in seconds): `door` (0 shut .. 1
                      open), the controls the clip was authored against (`wheel_deg`, or `cyclic_fwd_deg`,
                      `cyclic_right_deg`, `collective_deg`, `pedal_m`; the packs' sign conventions), and the
                      character root's place in Unreal component space (`root_x_cm`, `root_y_cm`, `root_yaw_deg`)
  events.csv          DataTable CSV: Clip, Event, Seconds, Frame (the notes' `events`)
  contacts.csv        DataTable CSV: one row per contact span (the notes' `contacts`): the vehicle bone, the
                      character bone, frames and seconds, kind, point, the contact point in the vehicle bone's
                      Unreal space (cm), and the character bone's transform relative to the vehicle bone (cm,
                      FQuat), averaged over the span, with how much it moves inside the span
  fit.csv             DataTable CSV: the pack's vehicleFit per vehicle bone, Unreal parent-bone space (cm)
  clips.csv           DataTable CSV: per clip the vehicle, files, frames, seconds, loop, root at the first and
                      last frame (Unreal), event and contact counts
  vehicle_data.json   all of the above in one file, with the glTF values beside the Unreal ones and the rules
Also unreal/review/vehicle_data_check.json (the contact spans' spreads: how well the clips' hands and feet stay
on the vehicle parts when those parts move by the controls written here).
"""
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

import config
import gltfio as G
import skeleton as S
import vehicle as V

PART_BONE = {'hand_l': 'hand_l', 'hand_r': 'hand_r', 'foot_l': 'foot_l', 'foot_r': 'foot_r'}

# The controls in Unreal terms (derived from the glTF definitions in vehicle.py: a rotation by t about a glTF
# local axis a becomes a rotation by -t about U3 a in the bone's Unreal space; FQuat(axis, angle) is the standard
# right-hand rule in Unreal's coordinates; FRotator: Roll = -angle about X, Pitch = -angle about Y, Yaw = +angle
# about Z).
CONTROL_RULES = {
    'car': {
        'door': dict(bone='door_L', gltf='local rotation = rest * Rx(-55 deg * door)',
                     unreal='bone-space rotation = rest * FQuat(X, +55 deg * door)  (FRotator Roll = -55 * door)'),
        'wheel_deg': dict(bone='steering_wheel', gltf='local rotation = rest * Ry(wheel)  (+ = turned left)',
                          unreal='bone-space rotation = rest * FQuat(Z, -wheel)  (FRotator Yaw = -wheel)'),
    },
    'heli': {
        'door': dict(bone='cockpit_door_R', gltf='local rotation = rest * Ry(+68 deg * door)',
                     unreal='bone-space rotation = rest * FQuat(Z, -68 deg * door)  (FRotator Yaw = -68 * door)'),
        'cyclic_fwd_deg': dict(bone='cyclic', gltf='local rotation = rest * Rx(-fwd) * Rz(-right)  (pivot at the floor)',
                               unreal='bone-space rotation = rest * FQuat(X, +fwd) * FQuat(Y, +right)'),
        'cyclic_right_deg': dict(bone='cyclic', gltf='(with cyclic_fwd_deg)', unreal='(with cyclic_fwd_deg)'),
        'collective_deg': dict(bone='collective', gltf='local rotation = rest * Rx(+coll)  (+ raises the grip)',
                               unreal='bone-space rotation = rest * FQuat(X, -coll)  (FRotator Roll = +coll)'),
        'pedal_m': dict(bone='pedal_L, pedal_R', gltf='translation (0, 0, -push) in the parent (vehicle root) frame, push = '
                        '+pedal for pedal_L, -pedal for pedal_R (+ pushes the left pedal forward)',
                        unreal='component-space translation (0, -100 * push, 0) cm added to the bone (forward = -Y)'),
    },
}
CURVE_OF = {'wheel': 'wheel_deg', 'fwd': 'cyclic_fwd_deg', 'right': 'cyclic_right_deg', 'coll': 'collective_deg',
            'pedal': 'pedal_m'}


def r6(x):
    return float(round(float(x), 6))


def write_csv(path, header, rows):
    with open(path, 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        for r in rows:
            w.writerow([('%.6g' % v) if isinstance(v, float) else v for v in r])


def quat_mean(qs):
    q0 = qs[len(qs) // 2]
    acc = np.zeros(4)
    for q in qs:
        acc += q if q @ q0 >= 0 else -q
    return acc / np.linalg.norm(acc)


def contact_rows(sk, veh, clip, nc, locals_, ctls, fit):
    """Per contact span: the character bone in the vehicle node's frame (glTF), mean and spread."""
    out = []
    n = len(locals_)
    cache = {}
    for i, c in enumerate(nc['contacts']):
        bone = PART_BONE[c['part']]
        node = c['node'] or veh.root
        a, b = int(c['from']), min(int(c['to']), n - 1)
        rel = []
        for f in range(a, b + 1):
            if f not in cache:
                cache[f] = (sk.world(locals_[f]), veh.world(veh.pose(ctls[f], fit)))
            wc, wv = cache[f]
            rel.append(np.linalg.inv(wv[node]) @ wc[bone])
        P = np.array([m[:3, 3] for m in rel])
        Q = np.array([G.m_to_q(m[:3, :3]) for m in rel])
        qm = quat_mean(Q)
        mean = np.eye(4)
        mean[:3, :3] = G.q_to_m(qm)
        mean[:3, 3] = P.mean(0)
        spread_cm = float(np.linalg.norm(P - P.mean(0), axis=1).max()) * 100
        spread_deg = float(max(G.angle_deg(G.q_to_m(q), mean[:3, :3]) for q in Q))
        at = np.array(c['at'], float)
        loc, quat = V.ue_transform(mean)
        out.append(dict(index=i, part=c['part'], bone=bone, node=c['node'], vehicleBone=node, fromFrame=a, toFrame=b,
                        fromSeconds=r6(a / V.FPS), toSeconds=r6(b / V.FPS), kind=c.get('kind'), point=c.get('point', 'palm' if bone.startswith('hand') else None),
                        atGltf=[r6(x) for x in at], atUnrealCm=[r6(x) for x in V.ue_point(at)],
                        boneInNodeGltf=dict(t=[r6(x) for x in mean[:3, 3]], q=[r6(x) for x in qm]),
                        boneInNodeUnreal=dict(locationCm=[r6(x) for x in loc], quat=[r6(x) for x in quat]),
                        spreadCm=r6(spread_cm), spreadDeg=r6(spread_deg),
                        boneToPointCm=r6(np.linalg.norm(mean[:3, 3] - at) * 100)))
    return out


def materials(vname):
    """vehicles/textures/<vehicle>/materials.json: every glTF material's parameters with the texture file names
    (as written beside by build_unreal.textures_beside), and the parts that use it. The FBX carries only base
    colour, normal, emissive colour and opacity; build the rest (ORM, clearcoat, emissive strength) by hand."""
    veh = V.Vehicle(vname)
    j = veh.g.json
    ext = {'image/png': '.png', 'image/jpeg': '.jpg'}

    def tex(t):
        if not t:
            return None
        im = j['images'][j['textures'][t['index']]['source']]
        return dict({'file': im['name'] + ext[im['mimeType']]}, **{k: v for k, v in t.items() if k != 'index'})
    users = {}
    for n, mi in veh.mesh.items():
        for prim in j['meshes'][mi]['primitives']:
            if 'material' in prim:
                users.setdefault(prim['material'], set()).add(n)
    out = []
    for i, m in enumerate(j['materials']):
        pbr = m.get('pbrMetallicRoughness', {})
        e = m.get('extensions', {})
        out.append(dict(name=m.get('name'), alphaMode=m.get('alphaMode', 'OPAQUE'), alphaCutoff=m.get('alphaCutoff'),
                        doubleSided=m.get('doubleSided', False), baseColorFactor=pbr.get('baseColorFactor', [1, 1, 1, 1]),
                        baseColorTexture=tex(pbr.get('baseColorTexture')), metallicFactor=pbr.get('metallicFactor', 1.0),
                        roughnessFactor=pbr.get('roughnessFactor', 1.0),
                        metallicRoughnessTexture=tex(pbr.get('metallicRoughnessTexture')),
                        normalTexture=tex(m.get('normalTexture')), occlusionTexture=tex(m.get('occlusionTexture')),
                        emissiveFactor=m.get('emissiveFactor'), emissiveTexture=tex(m.get('emissiveTexture')),
                        emissiveStrength=e.get('KHR_materials_emissive_strength', {}).get('emissiveStrength'),
                        clearcoat=e.get('KHR_materials_clearcoat'), parts=sorted(users.get(i, []))))
    d = os.path.join(config.OUT, 'vehicles', 'textures', vname)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'materials.json'), 'w') as fh:
        json.dump({'vehicle': vname, 'source': config.rel(veh.glb),
                   'note': 'glTF metallic-roughness: metallicRoughnessTexture G = roughness, B = metallic (the *_orm files: '
                           'R = occlusion too); normal maps are OpenGL (+Y up): flip green in Unreal; colours linear, '
                           'base colour textures sRGB', 'materials': out}, fh, indent=1)


def main():
    for v in config.VEHICLES:
        materials(v)
    report = {}
    vehs = {k: V.Vehicle(n) for n, k in ((n, config.VEHICLES[n]['kind']) for n in config.VEHICLES)}
    for pk, pcfg in config.VEHICLE_PACKS.items():
        skel = pcfg['skeleton']
        sk = S.Skeleton(skel, pack=pk)
        notes = sk.notes
        outdir = os.path.join(config.OUT, 'animations', pk, 'data')
        os.makedirs(outdir, exist_ok=True)
        for fn in os.listdir(outdir):
            if fn.startswith('curves_') and fn.endswith('.csv'):
                os.remove(os.path.join(outdir, fn))
        J = dict(pack=pk, source=config.rel(pcfg['notes']), skeleton=skel, body=config.PACKS[skel]['body'],
                 fps=30, rules=dict(
                     axes='Unreal component / bone space as the FBX import gives it (Convert Scene on, Force Front X '
                          'off): the vehicle faces -Y, its right is +X, up +Z; the bodies face +Y at rest.',
                     point='a point or direction in a vehicle node\'s glTF frame (or the vehicle root\'s, the clips\' space), '
                           'metres (x, y, z) -> the same vehicle bone\'s Unreal space, cm (100 x, 100 z, 100 y)',
                     root='notes root [x, z, yaw] -> character root bone in the vehicle\'s component space: location '
                          '(100 x, 100 z, 0) cm, rotation FRotator Yaw = -yaw in degrees',
                     onePose='one-pose clips (one key in the GLB) are written as 2 identical frames (0 and 1)',
                     loops='loops (car-drive, heli-fly) keep their closing frame: 241 frames, frame 240 = frame 0; '
                           'the notes give 240 per-frame values, the curves here 241'),
                 controls=CONTROL_RULES, fit={}, clips={})
        # vehicle fit
        fit_rows = []
        for kind, nodes in notes.get('vehicleFit', {}).items():
            vname = config.VEHICLE_OF_KIND[kind]
            J['fit'][vname] = {}
            for node, spec in nodes.items():
                ue = V.ue_point(spec['translate'])
                J['fit'][vname][node] = dict(translateGltf=spec['translate'], translateUnrealCm=[r6(x) for x in ue],
                                             parent=vehs[kind].parent[node], scale=spec.get('scale'), why=spec.get('why'))
                fit_rows.append([f'{vname}_{node}', vname, node, vehs[kind].parent[node], *[r6(x) for x in ue],
                                 *spec['translate'], spec.get('why', '')])
        write_csv(os.path.join(outdir, 'fit.csv'),
                  ['Name', 'Vehicle', 'Bone', 'ParentBone', 'X_cm', 'Y_cm', 'Z_cm', 'GltfX_m', 'GltfY_m', 'GltfZ_m', 'Why'],
                  fit_rows)
        ev_rows, ct_rows, clip_rows = [], [], []
        rep = report[pk] = {}
        for clip, nc in notes['clips'].items():
            kind = nc['vehicle']
            veh = vehs[kind]
            vname = config.VEHICLE_OF_KIND[kind]
            fit = V.fit_of(notes, kind)
            L = sk.clip_locals(clip, min_frames=2)
            nf = len(L)
            ctls = V.clip_controls(kind, clip, nc, nf)
            times = [r6(f / V.FPS) for f in range(nf)]
            root = nc['root']
            curves = {'door': [r6(c['door']) for c in ctls]}
            for k in config.CONTROL_NAMES[kind][1:]:
                curves[CURVE_OF[k]] = [r6(c[k]) for c in ctls]
            rx, ry, ryaw = [], [], []
            for f in range(nf):
                x, z, yaw = root[f % len(root)] if nc.get('loop') else root[min(f, len(root) - 1)]
                loc, yaw_ue = V.ue_root(x, z, yaw)
                rx.append(r6(loc[0]))
                ry.append(r6(loc[1]))
                ryaw.append(r6(yaw_ue))
            curves.update(root_x_cm=rx, root_y_cm=ry, root_yaw_deg=ryaw)
            with open(os.path.join(outdir, f'curves_{clip}.csv'), 'w', newline='') as fh:
                w = csv.writer(fh, lineterminator='\n')
                w.writerow(['---'] + ['%.6g' % t for t in times])
                for name, vals in curves.items():
                    w.writerow([name] + ['%.6g' % v for v in vals])
            events = {e: s for e, s in nc.get('events', {}).items() if isinstance(s, (int, float))}
            extra = {e: s for e, s in nc.get('events', {}).items() if not isinstance(s, (int, float))}   # (seatedPose)
            for e, s in events.items():
                ev_rows.append([f'{clip}_{e}', clip, e, r6(s), int(round(s * V.FPS))])
            cts = contact_rows(sk, veh, clip, nc, L, ctls, fit)
            for c in cts:
                ct_rows.append([f"{clip}_{c['index']:02d}", clip, c['part'], c['bone'], c['vehicleBone'], c['fromFrame'],
                                c['toFrame'], c['fromSeconds'], c['toSeconds'], c['kind'], c['point'],
                                *c['atUnrealCm'], *c['boneInNodeUnreal']['locationCm'], *c['boneInNodeUnreal']['quat'],
                                c['spreadCm'], c['spreadDeg']])
            first, last = V.ue_root(*root[0]), V.ue_root(*root[-1 if not nc.get('loop') else 0])
            files = dict(character=f'animations/{pk}/{clip}.fbx', vehicle=f'vehicles/{vname}.fbx',
                         vehicleAnimation=f'vehicles/animations/{pk}/{vname}_{clip}.fbx', curves=f'animations/{pk}/data/curves_{clip}.csv')
            clip_rows.append([clip, vname, files['character'], files['vehicleAnimation'], nf, r6((nf - 1) / V.FPS),
                              bool(nc.get('loop')), nf == 2 and nc['frames'] == 1, *[r6(x) for x in first[0][:2]], r6(first[1]),
                              *[r6(x) for x in last[0][:2]], r6(last[1]), len(events), len(cts), extra.get('seatedPose', '')])
            J['clips'][clip] = dict(vehicle=vname, files=files, frames=nf, seconds=r6((nf - 1) / V.FPS),
                                    loop=bool(nc.get('loop')), onePose=nc['frames'] == 1,
                                    events={e: dict(seconds=s, frame=int(round(s * V.FPS))) for e, s in events.items()},
                                    seatedPose=extra.get('seatedPose'),
                                    contacts=cts, curves=curves, times=times)
            rep[clip] = dict(contacts=len(cts), worstSpreadCm=max((c['spreadCm'] for c in cts), default=0.0),
                             worstSpreadDeg=max((c['spreadDeg'] for c in cts), default=0.0),
                             worstContact=max(cts, key=lambda c: c['spreadCm'])['part'] + ' on ' +
                             str(max(cts, key=lambda c: c['spreadCm'])['vehicleBone']) if cts else None)
        write_csv(os.path.join(outdir, 'events.csv'), ['Name', 'Clip', 'Event', 'Seconds', 'Frame'], ev_rows)
        write_csv(os.path.join(outdir, 'contacts.csv'),
                  ['Name', 'Clip', 'Part', 'CharacterBone', 'VehicleBone', 'FromFrame', 'ToFrame', 'FromSeconds', 'ToSeconds',
                   'Kind', 'Point', 'PointX_cm', 'PointY_cm', 'PointZ_cm', 'BoneX_cm', 'BoneY_cm', 'BoneZ_cm', 'BoneQX',
                   'BoneQY', 'BoneQZ', 'BoneQW', 'SpreadCm', 'SpreadDeg'], ct_rows)
        write_csv(os.path.join(outdir, 'clips.csv'),
                  ['Name', 'Vehicle', 'CharacterFbx', 'VehicleAnimFbx', 'Frames', 'Seconds', 'Loop', 'OnePose',
                   'RootStartX_cm', 'RootStartY_cm', 'RootStartYaw_deg', 'RootEndX_cm', 'RootEndY_cm', 'RootEndYaw_deg',
                   'Events', 'Contacts', 'SeatedPose'], clip_rows)
        with open(os.path.join(outdir, 'vehicle_data.json'), 'w') as fh:
            json.dump(J, fh, indent=1)
    os.makedirs(os.path.join(config.OUT, 'review'), exist_ok=True)
    with open(os.path.join(config.OUT, 'review', 'vehicle_data_check.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
    return report


if __name__ == '__main__':
    rep = main()
    for pk, r in rep.items():
        for clip, x in r.items():
            print(pk, clip, x)
