"""Re-bind a prepared UE5-named body in another pose (pass T1a follow-up): pose the T-pose body into an
A-pose (R1's `retargetPoses.ue5_apose` shoulder / elbow / hand angles; legs and trunk as modelled) or
the canonical arms-down pose, deform it there OFFLINE with Blender's best deformer (Armature modifier
with Preserve Volume = dual quaternions, then a Corrective Smooth restricted to the shoulder / armpit /
upper-back region, rest = the modelled T-pose mesh so detail is kept), and write that shape as the new
bind mesh with the skeleton bound in the pose (inverse bind matrices, rest rotations), normals
recomputed; UVs, weights, vertex order unchanged. The result is a source GLB for prepare_body.py, which
re-derives A[b] / R[b] from the new bind.

  Blender -b --factory-startup --python-exit-code 1 --python blender/bodies/rebind.py -- \
      --src blender/bodies/tripo/source/tripo_main_character.glb --pose apose --out <dir>/tripo-apose-src.glb
  options: --no-repair (delivered shoulder weights), --cs-factor 0.5 --cs-iter 20, --no-cs
"""
import argparse
import json
import pathlib
import sys
import warnings

import numpy as np

warnings.filterwarnings('ignore', category=RuntimeWarning)
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import prepare_body as PB  # noqa: E402
import ue5body as U  # noqa: E402
from ue5_rig import ue5  # noqa: E402
from ue5_rig.proof import Mesh  # noqa: E402

ROOT = HERE.parent.parent
ARM = ('upperarm', 'lowerarm', 'hand')
OLD_ARM = {'upperarm': 'Arm', 'lowerarm': 'ForeArm', 'hand': 'Hand'}
LEG = ('thigh', 'calf', 'foot', 'ball', 'thigh_twist_01', 'thigh_twist_02', 'calf_twist_01', 'calf_twist_02')


def apose_old_world():
    """R1's A-pose as old-joint world turns Q (bone world = Q * R1rest): arms only."""
    d = json.loads(U.MAPPING.read_text())
    bones = d['bones']
    loc = d['retargetPoses']['ue5_apose']['local']
    W = {}
    for n, e in bones.items():   # parents first in the file
        L = ue5.q_to_m(loc.get(n, e['restLocalRotation']))
        W[n] = L if e['parent'] is None else W[e['parent']] @ L
    Q = {}
    for s, S in (('l', 'Left'), ('r', 'Right')):
        for b in ARM:
            R1 = ue5.q_to_m(bones[f'{b}_{s}']['restWorldRotation'])
            Q[S + OLD_ARM[b]] = W[f'{b}_{s}'] @ R1.T
    return Q


def target_pose(B, pose):
    rig, p = B['rig'], B['p']
    Q = apose_old_world() if pose == 'apose' else {}
    L, T, Wd, Pd = rig.map_old(Q)
    # legs (and the IK feet) as modelled
    for n in p.names:
        if any(n == f'{x}_{s}' for x in LEG for s in 'lr'):
            par = p.parent[n]
            L[n] = p.W[par].T @ p.W[n]
    for n in U.IK:
        T.pop(n, None)
        L.pop(n, None)
    Wd, Pd = rig.fk(L, T)
    for n in U.IK:
        if U.IK_TARGET[n]:
            Wd[n], Pd[n] = Wd[U.IK_TARGET[n]].copy(), Pd[U.IK_TARGET[n]].copy()
        else:
            Wd[n], Pd[n] = np.eye(3), np.zeros(3)
    return Wd, Pd


def welded_normals(mesh, pos):
    w = pos[mesh.first]
    t = mesh.wtris
    fn = np.cross(w[t[:, 1]] - w[t[:, 0]], w[t[:, 2]] - w[t[:, 0]])
    vn = np.zeros_like(w)
    for k in range(3):
        np.add.at(vn, t[:, k], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-15
    return vn[mesh.weld]


def deform(p, J, Wt, Wd, Pd, cs_factor, cs_iter, use_cs):
    import bpy
    from mathutils import Matrix
    mesh = Mesh(type('S', (), {'prims': [dict(pos=p.pos, tris=p.tris)]})())
    C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    sc = bpy.context.scene
    me = bpy.data.meshes.new('body')
    me.from_pydata([tuple(C @ v) for v in mesh.wrest], [], [tuple(int(i) for i in t) for t in mesh.wtris])
    obj = bpy.data.objects.new('body', me)
    sc.collection.objects.link(obj)
    arm_d = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rig', arm_d)
    sc.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for n in p.names:
        eb = arm_d.edit_bones.new(n)
        eb.head = (0, 0, 0)
        eb.tail = (0, 0.03, 0)
        M = np.eye(4)
        M[:3, :3] = C @ p.W[n]
        M[:3, 3] = C @ p.P[n]
        eb.matrix = Matrix(M.tolist())
    for n in p.names:
        if p.parent[n]:
            arm_d.edit_bones[n].parent = arm_d.edit_bones[p.parent[n]]
    bpy.ops.object.mode_set(mode='OBJECT')
    # pose: matrix_basis = Mrest^-1 Mrest_parent Mpose_parent^-1 Mpose (frames as glTF; conjugation cancels)
    for n in p.names:
        Mr = U.mat4(p.W[n], p.P[n])
        Mp = U.mat4(Wd[n], Pd[n])
        par = p.parent[n]
        if par:
            basis = np.linalg.inv(Mr) @ U.mat4(p.W[par], p.P[par]) @ np.linalg.inv(U.mat4(Wd[par], Pd[par])) @ Mp
        else:
            basis = np.linalg.inv(Mr) @ Mp
        arm.pose.bones[n].matrix_basis = Matrix(basis.tolist())
    # vertex groups (welded vertex = its first source vertex)
    dense = np.zeros((len(p.pos), len(p.names)))
    np.add.at(dense, (np.repeat(np.arange(len(p.pos)), 4), J.ravel()), Wt.ravel())
    dw = dense[mesh.first]
    for k, n in enumerate(p.names):
        idx = np.nonzero(dw[:, k] > 0)[0]
        if not len(idx):
            continue
        vg = obj.vertex_groups.new(name=n)
        for i in idx:
            vg.add([int(i)], float(dw[i, k]), 'REPLACE')
    region = np.zeros(len(dw))
    for s in 'lr':
        ks = [p.index[f'{b}_{s}'] for b in ('clavicle', 'upperarm', 'upperarm_twist_01', 'upperarm_twist_02')]
        region += dw[:, ks].sum(1)
    region += 0.5 * dw[:, [p.index['spine_05'], p.index['spine_04']]].sum(1)
    region = np.clip(1.5 * region, 0, 1)
    vg = obj.vertex_groups.new(name='cs_region')
    for i in np.nonzero(region > 0)[0]:
        vg.add([int(i)], float(region[i]), 'REPLACE')
    mod = obj.modifiers.new('arm', 'ARMATURE')
    mod.object = arm
    mod.use_deform_preserve_volume = True
    if use_cs:
        cs = obj.modifiers.new('cs', 'CORRECTIVE_SMOOTH')
        cs.rest_source = 'ORCO'
        cs.factor = cs_factor
        cs.iterations = cs_iter
        cs.smooth_type = 'LENGTH_WEIGHTED'
        cs.vertex_group = 'cs_region'
        cs.use_pin_boundary = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    co = np.array([v.co[:] for v in ev.data.vertices])
    if len(co) != len(mesh.wrest):
        raise ValueError('vertex count changed in the modifier stack')
    new_w = co @ C       # blender -> glTF (C orthogonal: g = C^T b)
    return new_w[mesh.weld], mesh


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--pose', default='apose', choices=('apose', 'canonical'))
    ap.add_argument('--reference', default=str(ROOT / 'public/characters/civilian-m-01-player-ue5.glb'))
    ap.add_argument('--no-repair', action='store_true')
    ap.add_argument('--no-cs', action='store_true')
    ap.add_argument('--cs-factor', type=float, default=0.5)
    ap.add_argument('--cs-iter', type=int, default=20)
    a = ap.parse_args(argv)
    B = PB.build(a.src, a.reference, shoulder=not a.no_repair)
    p = B['p']
    Wd, Pd = target_pose(B, a.pose)
    pos, mesh = deform(p, B['J'], B['Wt'], Wd, Pd, a.cs_factor, a.cs_iter, not a.no_cs)
    lbs = U.skin(p.pos, B['J'], B['Wt'], B['rig'].mats(Wd, Pd))
    print(f'[rebind] {a.pose}: offline shape vs linear blend: max {np.abs(pos - lbs).max() * 1000:.1f} mm, '
          f'mean {np.linalg.norm(pos - lbs, axis=1).mean() * 1000:.2f} mm; soles {pos[:, 1].min():.4f}', flush=True)
    p.pos = pos
    p.nrm = welded_normals(mesh, pos).astype(np.float32)
    p.W = {n: Wd[n] for n in p.names}
    p.P = {n: Pd[n] for n in p.names}
    PB.write_body(p, B['J'], B['Wt'], a.out, dict(contract='earthonline-ue5-v1', bindPose=f'{a.pose} re-bind of {a.src} (rebind.py)',
                                                  rebind=dict(pose=a.pose, repair=not a.no_repair, correctiveSmooth=None if a.no_cs else [a.cs_factor, a.cs_iter])))
    print('[rebind] wrote', a.out, flush=True)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
