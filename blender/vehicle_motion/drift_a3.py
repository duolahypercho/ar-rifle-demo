# exec in Blender after a run: per foot, sole points' height above whatever is under them (vehicle meshes or the ground y=0),
# and the horizontal drift while within 1.5 cm (per run of such frames)
import sys; sys.path.insert(0,__import__('os').path.expanduser('~/Desktop/Code/test/ar_rifle_demo/blender'))
from mathutils import Vector
from vehicle_motion import judge
ctx = bpy.app.driver_namespace['vehicle_motion']; L = ctx['last']; kind = L['meta']['vehicle']
p = ctx['props'][kind]; veh = p['veh']; T = p['test']
V = judge.world_parts(L['baked'], L['roots'])
ctls = L['meta'].get('_ctl') or None
names = [n for n in T.meshes]
res = {}
for side in ('l', 'r'):
    runs, cur, worst = [], None, (0, None)
    for i, v in enumerate(V):
        ctl = L['V'][i]['ctl'] if 'ctl' in L['V'][i] else {}
        tree, owner = T._tree(names, ctl)
        hs = []
        for key in ('ball_' + side, 'heel_' + side):
            q = v[key]
            loc, n, idx, d = tree.ray_cast(q + Vector((0, 0.04, 0)), Vector((0, -1, 0)), 2.0)
            surf = max(loc.y if loc is not None else -9, 0.0)
            hs.append(q.y - surf)
        h = min(hs)
        pt = (v['ball_' + side] + v['heel_' + side]) / 2
        if h <= 0.015:
            if cur is None:
                cur = [i, pt, pt, 0.0]
            d = Vector((pt.x - cur[1].x, 0, pt.z - cur[1].z)).length
            cur[3] = max(cur[3], d); cur[2] = pt
        else:
            if cur: runs.append((cur[0], i - 1, round(cur[3] * 100, 2)))
            cur = None
    if cur: runs.append((cur[0], len(V) - 1, round(cur[3] * 100, 2)))
    bad = [r for r in runs if r[2] > 1.0]
    print('foot_' + side, 'runs', len(runs), 'max drift cm', max((r[2] for r in runs), default=0), 'over 1 cm:', bad[:8])
